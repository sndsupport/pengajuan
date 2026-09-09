"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { ExternalLink, Paperclip } from "lucide-react";

type Attachment = { id: string; fileName: string; fileUrl: string };

export function AttachmentsList({ submissionId }: { submissionId: string }) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, "submissions", submissionId, "attachments"))
      .then((snap) => {
        if (cancelled) return;
        setAttachments(
          snap.docs.map((d) => ({
            id: d.id,
            fileName: d.data().fileName as string,
            fileUrl: d.data().fileUrl as string,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  if (error) {
    return <p className="text-sm text-destructive">Gagal memuat lampiran.</p>;
  }
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Paperclip className="h-3.5 w-3.5" />
        Lampiran
      </p>
      <ul className="space-y-1">
        {attachments.map((a) => (
          <li key={a.id}>
            <a
              href={a.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              {a.fileName}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
