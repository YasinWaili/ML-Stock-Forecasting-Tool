"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "../research-types";

export async function researchRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) {
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : "Check the dates, stock symbols, and simulation settings.";
    throw new Error(detail);
  }
  return payload as T;
}

export function useResearchJob() {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const cancel = useCallback(() => controller.current?.abort(), []);
  useEffect(() => cancel, [cancel]);
  const watch = useCallback(async (initial: Job, signal: AbortSignal) => {
    let current = initial;
    while (!signal.aborted) {
      setJob(current);
      if (current.status === "completed") return current;
      if (current.status === "failed")
        throw new Error(current.error || "The research run failed.");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (signal.aborted) return null;
      current = await researchRequest<Job>(`/api/jobs/${current.id}`, {
        signal,
      });
    }
    return null;
  }, []);
  const run = useCallback(
    async (params: Record<string, unknown>) => {
      cancel();
      const next = new AbortController();
      controller.current = next;
      setError("");
      setJob(null);
      setSubmitting(true);
      try {
        const initial = await researchRequest<Job>("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          signal: next.signal,
        });
        if (next.signal.aborted) return null;
        setSubmitting(false);
        return await watch(initial, next.signal);
      } catch (caught) {
        if (!next.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Research is unavailable.",
          );
        return null;
      } finally {
        if (!next.signal.aborted) setSubmitting(false);
      }
    },
    [cancel, watch],
  );
  const open = useCallback(
    async (id: string) => {
      cancel();
      const next = new AbortController();
      controller.current = next;
      setError("");
      setJob(null);
      setSubmitting(true);
      try {
        const initial = await researchRequest<Job>(`/api/jobs/${id}`, {
          signal: next.signal,
        });
        if (next.signal.aborted) return null;
        setSubmitting(false);
        return await watch(initial, next.signal);
      } catch (caught) {
        if (!next.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Saved run is unavailable.",
          );
        return null;
      } finally {
        if (!next.signal.aborted) setSubmitting(false);
      }
    },
    [cancel, watch],
  );
  return {
    job,
    error,
    submitting,
    busy:
      !error &&
      (submitting || job?.status === "queued" || job?.status === "running"),
    run,
    open,
    cancel,
  };
}
