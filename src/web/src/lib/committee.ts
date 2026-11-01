/**
 * Committee Todo API client. Reads/writes the committee Google Sheet via the
 * public (no-auth) /api/committee routes and enriches people with a derived
 * accent + a CDN photo URL built straight from regid (no whos-coming call).
 */

import { publicClient } from "./http";
import type { CommitteePerson, CommitteeTask } from "@/components/committee/model";
import { accentFor } from "@/components/committee/model";

interface PersonDTO {
  name: string;
  regid: string | null;
}

interface BoardDTO {
  people: PersonDTO[];
  tasks: CommitteeTask[];
  thumbsBaseUrl: string;
}

export interface CommitteeBoard {
  people: CommitteePerson[];
  tasks: CommitteeTask[];
}

export type CommitteeMutation =
  | { op: "toggle"; row: number; expectTask: string }
  | { op: "add"; assignee: string; title: string; due?: string; notes?: string }
  | { op: "addSub"; parentRow: number; expectParentTask: string; title: string }
  | { op: "assign"; row: number; expectTask: string; assignee: string }
  | {
      op: "edit";
      row: number;
      expectTask: string;
      title: string;
      due: string | null;
      notes: string | null;
    };

function enrich(dto: BoardDTO): CommitteeBoard {
  const people: CommitteePerson[] = dto.people.map((p) => ({
    name: p.name,
    regid: p.regid,
    accent: accentFor(p.name),
    photoSrc: p.regid ? `${dto.thumbsBaseUrl}/${p.regid}.jpg` : undefined,
  }));
  return { people, tasks: dto.tasks };
}

export async function fetchCommitteeBoard(): Promise<CommitteeBoard> {
  return enrich(await publicClient<BoardDTO>("/api/committee/todos"));
}

export async function mutateCommittee(m: CommitteeMutation): Promise<CommitteeBoard> {
  return enrich(
    await publicClient<BoardDTO>("/api/committee/todos/mutate", {
      method: "POST",
      json: m,
    }),
  );
}
