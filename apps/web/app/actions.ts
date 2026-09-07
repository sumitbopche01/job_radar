"use server";

import { revalidatePath } from "next/cache";
import {
  markApplied,
  rejectJob,
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
