export interface C1Socket {
  send: (payload: string) => void;
  close: () => void;
  onOpen: (listener: () => void) => void;
  onMessage: (listener: (payload: string) => void) => void;
  onClose: (listener: () => void) => void;
  onError: (listener: () => void) => void;
}

export interface C1Scheduler {
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (handle: number) => void;
}

export function createBrowserSocket(url: string): C1Socket {
  const socket = new WebSocket(url);
  return {
    send: (payload) => {
      socket.send(payload);
    },
    close: () => {
      socket.close();
    },
    onOpen: (listener) => {
      socket.addEventListener("open", () => {
        listener();
      });
    },
    onMessage: (listener) => {
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          listener(event.data);
        }
      });
    },
    onClose: (listener) => {
      socket.addEventListener("close", () => {
        listener();
      });
    },
    onError: (listener) => {
      socket.addEventListener("error", () => {
        listener();
      });
    },
  };
}

export const defaultScheduler: C1Scheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => {
    globalThis.clearTimeout(handle);
  },
};
