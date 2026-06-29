"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { keccak256, stringToHex, encodePacked, toBytes } from "viem";
import { useNow } from "@/hooks/useNow";
import bountyJudgeAbi from "@/abi/BountyJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import type { Bounty } from "@/lib/bounty";
import { canCommit, canReveal } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Input,
  Button,
  TxStatus,
  Notice,
  Spinner,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

/**
 * Generates a cryptographically-random 32-byte salt.
 * Uses crypto.getRandomValues when available.
 */
function generateSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/**
 * Compute keccak256(answer, salt, msg.sender, bountyId) locally.
 */
function computeCommitment(
  answer: string,
  salt: `0x${string}`,
  submitter: `0x${string}`,
  bountyId: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, submitter, bountyId],
    ),
  );
}

export function CommitAnswer({
  bountyId,
  bounty,
  isEncrypted,
  onDone,
}: {
  bountyId: bigint;
  bounty: Bounty;
  isEncrypted?: boolean;
  onDone: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [answer, setAnswer] = useState("");
  const [salt, setSalt] = useState<`0x${string}`>(generateSalt());
  const [phase, setPhase] = useState<"commit" | "reveal" | "done">("commit");
  const now = useNow();

  const commitTx = useWriteTx(() => {
    setPhase("reveal");
    onDone();
  });
  const revealTx = useWriteTx(() => {
    setPhase("done");
    onDone();
  });

  const canCommitPhase = canCommit(bounty, now / 1000);
  const canRevealPhase = canReveal(bounty, now / 1000);

  // If we already submitted a commitment, check if we can reveal
  // For simplicity, we let the user choose the phase
  const handleCommit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!address || !answer.trim() || !contractAddress) return;

      // Compute the commitment hash locally
      const commitment = computeCommitment(answer.trim(), salt, address, bountyId);

      try {
        await commitTx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "submitCommitment",
          args: [bountyId, commitment],
          chainId: ritualChain.id,
        });
      } catch {
        /* surfaced via tx.state */
      }
    },
    [address, answer, salt, bountyId, commitTx],
  );

  const handleReveal = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!address || !answer.trim() || !contractAddress) return;

      try {
        await revealTx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "revealAnswer",
          args: [bountyId, answer.trim(), salt],
          chainId: ritualChain.id,
        });
      } catch {
        /* surfaced via tx.state */
      }
    },
    [address, answer, salt, bountyId, revealTx],
  );

  // Show nothing if no address
  if (!address) return null;
  if (isEncrypted) return null;

  const regenSalt = () => setSalt(generateSalt());

  return (
    <Card>
      <CardHeader
        title={
          phase === "commit"
            ? "Phase 1 — Commit"
            : phase === "reveal"
              ? "Phase 2 — Reveal"
              : "Answer submitted"
        }
        subtitle={
          phase === "commit"
            ? "Hash your answer + salt & submit the commitment."
            : phase === "reveal"
              ? "After deadline, reveal your answer to verify the hash."
              : "Your commitment has been verified."
        }
      />
      <CardBody>
        {phase === "commit" && (
          <form onSubmit={handleCommit} className="space-y-3">
            {!canCommitPhase && (
              <Notice tone="amber">
                Submissions are closed (deadline passed). Wait for the reveal phase.
              </Notice>
            )}

            <Field label="Your answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={4}
                placeholder="Write your bounty submission…"
                disabled={!canCommitPhase}
              />
            </Field>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Salt (random) — keep this secret until reveal!">
                  <Input
                    value={salt}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("0x") && v.length === 66) {
                        setSalt(v as `0x${string}`);
                      }
                    }}
                    disabled={!canCommitPhase}
                    className="font-mono text-xs"
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={regenSalt}
                disabled={!canCommitPhase}
                className="mb-1"
              >
                New salt
              </Button>
            </div>

            {answer.trim() && (
              <div className="rounded-xl bg-black/30 px-3 py-2 text-xs text-zinc-400 break-all">
                <div className="font-medium text-zinc-300">Commitment hash (preview):</div>
                <code className="mt-1 block font-mono text-[10px]">
                  {computeCommitment(answer.trim(), salt, address, bountyId)}
                </code>
              </div>
            )}

            <Notice tone="amber">
              Save your salt! You must provide the same salt + answer to reveal. Without it, your
              commitment cannot be verified.
            </Notice>

            <Button
              type="submit"
              disabled={
                !isConnected || !canCommitPhase || !answer.trim() || commitTx.isBusy
              }
              className="w-full"
            >
              {commitTx.isBusy ? "Committing…" : "Submit commitment"}
            </Button>

            <TxStatus state={commitTx.state} error={commitTx.error} hash={commitTx.hash} explorerBase={explorerBase} />
          </form>
        )}

        {phase === "reveal" && (
          <form onSubmit={handleReveal} className="space-y-3">
            {!canRevealPhase && (
              <Notice tone="amber">
                Deadline hasn't passed yet. Reveal opens after the submission deadline.
              </Notice>
            )}

            <Field label="Your answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={4}
                placeholder="Write your bounty submission…"
                disabled={!canRevealPhase}
              />
            </Field>

            <Field label="Salt (the same one used during commit)">
              <Input
                value={salt}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("0x") && v.length === 66) {
                    setSalt(v as `0x${string}`);
                  }
                }}
                disabled={!canRevealPhase}
                className="font-mono text-xs"
              />
            </Field>

            <Button
              type="submit"
              disabled={
                !isConnected || !canRevealPhase || !answer.trim() || revealTx.isBusy
              }
              className="w-full"
            >
              {revealTx.isBusy ? "Revealing…" : "Reveal answer"}
            </Button>

            <TxStatus state={revealTx.state} error={revealTx.error} hash={revealTx.hash} explorerBase={explorerBase} />
          </form>
        )}

        {phase === "done" && (
          <Notice tone="green">
            Your answer has been revealed and verified. Wait for the bounty owner to judge and
            finalize.
          </Notice>
        )}
      </CardBody>
    </Card>
  );
}
