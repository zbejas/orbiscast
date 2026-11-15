import { createContext, useContext } from 'react';

export interface ShellContextValue {
    openNav: () => void;
}

export const ShellContext = createContext<ShellContextValue>({ openNav: () => undefined });

export function useShell(): ShellContextValue {
    return useContext(ShellContext);
}
