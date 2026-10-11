"use client";
/** /ws/live client with reconnect, folded into dashboard state. Owner: P3. */
import { useEffect, useReducer, useState } from "react";
import { EVENT_TYPES, type LiveEvent } from "@rxsolve/contracts";
import { initialState, reduce, type LiveState } from "./state";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/live";
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

function isLiveEvent(value: unknown): value is LiveEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.type === "string"
    && EVENT_TYPE_SET.has(event.type)
    && typeof event.ts === "string"
    && (typeof event.claim_id === "string" || event.claim_id === null)
    && "payload" in event;
}

export function useLive(): LiveState & { connected: boolean } {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let closed = false;

    const scheduleReconnect = () => {
      setConnected(false);
      if (closed || retry !== null) return;
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    };

    const connect = () => {
      if (closed) return;
      try {
        const socket = new WebSocket(WS_URL);
        ws = socket;
        socket.onopen = () => {
          if (ws !== socket || closed) return;
          retryDelay = 1000;
          setConnected(true);
          dispatch({ type: "reset" }); // The server replays its event history after connect.
        };
        socket.onmessage = ({ data }) => {
          if (ws !== socket || closed || typeof data !== "string") return;
          try {
            const event: unknown = JSON.parse(data);
            if (isLiveEvent(event)) dispatch({ type: "event", event });
          } catch {
            // Ignore malformed frames; a later valid event should keep the dashboard live.
          }
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
          if (ws === socket) scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { ...state, connected };
}
