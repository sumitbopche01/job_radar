"use server";

import { revalidatePath } from "next/cache";
import {
  markApplied,
  rejectJob,
  researchJob,
  setApplicationStatus,
  setNextAction,
  shortlistJob,
  type ApplicationStatus,
} from "@job-radar/core";
import { db } from "@/lib/db";

export async function shortlistAction(jobId: string) {
  await shortlistJob(db, jobId);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export async function rejectAction(jobId: string, reason?: string) {
  await rejectJob(db, jobId, reason);
  revalidatePath("/");
}

export async function appliedAction(jobId: string) {
  await markApplied(db, jobId);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export async function moveStatusAction(jobId: string, status: ApplicationStatus) {
  await setApplicationStatus(db, jobId, status);
  revalidatePath("/pipeline");
}

export async function nextActionAction(jobId: string, iso: string | null) {
  await setNextAction(db, jobId, iso ? new Date(iso) : null);
  revalidatePath("/pipeline");
}

/** Fetch real contacts + company dossier via web search (design §16 Agent 2). */
export async function researchAction(jobId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await researchJob(db, jobId);
    revalidatePath("/");
    return { ok: Boolean(res) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
