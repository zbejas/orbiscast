import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

let fixesPromise: Promise<void> | null = null;

/**
 * Correct signed Exp-Golomb mapping from the H.264 spec (9.1.1):
 * se(v) = 0 -> 0, positive v -> 2v - 1, negative v -> -2v.
 *
 * @param value - Signed value
 * @returns Unsigned code number
 */
export function signedExpGolombCodeNum(value: number): number {
    return value > 0 ? 2 * value - 1 : 2 * Math.abs(value);
}

/**
 * Patches known bugs in `@dank074/discord-video-stream` at runtime.
 *
 * - `AnnexBBitstreamWriter.writeSignedExpGolomb` maps 0 to -1 and throws
 *   ("Expected a non-negative number"). It runs on every H.264 SPS the library
 *   rewrites, so a channel whose SPS has a signed field equal to 0 can crash
 *   the whole process.
 * - An error while preparing a video frame is contained instead of escaping a
 *   stream callback.
 *
 * The library's dist modules are patched in place so its own imports see the
 * changes. Safe to call repeatedly; failures are logged, never thrown.
 *
 * @returns Promise that settles when the patches are applied or skipped
 */
export function applyLibraryFixes(): Promise<void> {
    fixesPromise ??= (async () => {
        try {
            const requireFromProject = createRequire(join(process.cwd(), 'package.json'));
            const entry = requireFromProject.resolve('@dank074/discord-video-stream');
            const distDir = dirname(entry);
            const writerModule = requireFromProject(
                join(distDir, 'client', 'processing', 'AnnexBBitstreamReaderWriter.js')
            ) as any;
            const proto = writerModule.AnnexBBitstreamWriter?.prototype;
            if (
                !proto ||
                typeof proto.writeSignedExpGolomb !== 'function' ||
                typeof proto.writeUnsignedExpGolomb !== 'function'
            ) {
                logger.warn('discord-video-stream layout changed; signed Exp-Golomb fix not applied');
                return;
            }

            guardVideoFrames(requireFromProject, distDir);

            let buggy = false;
            try {
                new writerModule.AnnexBBitstreamWriter().writeSignedExpGolomb(0);
            } catch {
                buggy = true;
            }
            if (!buggy) {
                logger.debug('discord-video-stream already handles se(0); no patch needed');
                return;
            }

            proto.writeSignedExpGolomb = function (
                this: { writeUnsignedExpGolomb(value: number): void },
                value: number
            ) {
                this.writeUnsignedExpGolomb(signedExpGolombCodeNum(value));
            };
            logger.debug('Patched discord-video-stream signed Exp-Golomb writer');
        } catch (error) {
            logger.warn(`Could not apply discord-video-stream fixes: ${error}`);
        }
    })();
    return fixesPromise;
}

/**
 * Wraps `WebRtcConnWrapper.sendVideoFrame` so a frame the library cannot
 * process is dropped and logged instead of crashing the process.
 *
 * @param requireFromProject - Require bound to the project root
 * @param distDir - The streaming library's dist directory
 */
function guardVideoFrames(requireFromProject: NodeRequire, distDir: string): void {
    try {
        const wrapper = requireFromProject(join(distDir, 'client', 'voice', 'WebRtcWrapper.js')) as any;
        const proto = wrapper.WebRtcConnWrapper?.prototype;
        if (!proto || typeof proto.sendVideoFrame !== 'function' || proto.sendVideoFrame.__orbiscastGuarded) {
            return;
        }
        const original = proto.sendVideoFrame;
        let failures = 0;
        const guarded = function (this: unknown, ...args: unknown[]) {
            try {
                return original.apply(this, args);
            } catch (error) {
                failures++;
                if (failures === 1 || failures % 500 === 0) {
                    logger.error(
                        `Dropped a video frame the streaming library could not process (${failures} so far): ${error}`
                    );
                }
                return undefined;
            }
        };
        (guarded as any).__orbiscastGuarded = true;
        proto.sendVideoFrame = guarded;
    } catch (error) {
        logger.warn(`Could not guard discord-video-stream video frames: ${error}`);
    }
}
