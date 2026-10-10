"use client";
/** /ws/live client with reconnect, folded into dashboard state. Owner: P3. */
import { useEffect, useReducer, useState } from "react";
import type { LiveEvent } from "@rxsolve/contracts";
import { initialState, reduce, type LiveState } from "./state";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/live";

export function useLive(): LiveState & { connected: boolean } {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { setConnected(true); dispatch({ type: "reset" }); }; // server replays history on open
      ws.onmessage = (m) => dispatch({ type: "event", event: JSON.parse(m.data) as LiveEvent });
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, []);

  return { ...state, connected };
}
