/**
 * Valid low-latency input options. The streaming library's `minimizeLatency`
 * passes `-flags lowdelay`, which FFmpeg rejects (the decoder constant is
 * `low_delay`), so OrbisCast applies the same intent itself.
 */
export const LOW_LATENCY_INPUT_OPTIONS = [
    '-fflags',
    'nobuffer',
    '-flags',
    'low_delay',
    '-flush_packets',
    '1',
    '-max_delay',
    '100000',
];

/** Number of FFmpeg stderr lines kept for a failure message. */
export const FFMPEG_LOG_LINES = 25;

/**
 * Filters FFmpeg's verbose output down to lines that help explain a failure,
 * skipping the version banner, build configuration, and library metadata.
 *
 * @param line - One line of FFmpeg stderr
 * @returns True if the line is worth keeping
 */
export function isUsefulFfmpegLine(line: string): boolean {
    const text = line.trim();
    if (!text) return false;
    return !/^(ffmpeg version|built with|configuration:|lib(avutil|avcodec|avformat|avdevice|avfilter|swscale|swresample|postproc)\b)/.test(
        text
    );
}

/**
 * Appends a useful FFmpeg stderr line to a bounded tail buffer.
 *
 * @param lines - Buffer to update in place
 * @param line - One line of FFmpeg stderr
 * @param limit - Maximum number of lines to keep
 */
export function appendFfmpegLine(lines: string[], line: string, limit = FFMPEG_LOG_LINES): void {
    if (!isUsefulFfmpegLine(line)) return;
    lines.push(line.trim());
    while (lines.length > limit) {
        lines.shift();
    }
}
