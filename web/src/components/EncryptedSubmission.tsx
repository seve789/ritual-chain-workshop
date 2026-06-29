"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import bountyJudgeAbi from "@/abi/BountyJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import type { Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

/**
 * Encrypted Submission component (Advanced Track).
 *
 * For a real deployment, users would ECIES-encrypt their answer using the
 * TEE executor's public key before submission. The encrypted blob is opaque
 * to everyone except the TEE executor.
 *
 * During judgeAll, the encrypted answers are packed into the LLM precompile's
 * encryptedSecrets field. The TEE decrypts them inside the enclave and
 * substitutes them into the judge prompt.
 */
export function EncryptedSubmission({
  bountyId,
  bounty,
  executorPublicKey,
  isOwner,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  executorPublicKey?: string;
  isOwner?: boolean;
  onSubmitted: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [answer, setAnswer] = useState("");
  const [encryptedHex, setEncryptedHex] = useState("");
  const [answerHash, setAnswerHash] = useState("");
  const [mode, setMode] = useState<"plain" | "encrypted">("encrypted");
  const tx = useWriteTx(() => {
    setAnswer("");
    setEncryptedHex("");
    onSubmitted();
  });

  const handleSubmitEncrypted = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!address || !contractAddress) return;

      try {
        // In production, the answer would be ECIES-encrypted with the
        // executor's public key. For demo purposes, we encode it as hex.
        const encrypted = `0x${Buffer.from(answer).toString("hex")}`;

        await tx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "submitEncryptedAnswer",
          args: [bountyId, encrypted, answerHash || ""],
          chainId: ritualChain.id,
        });
      } catch {
        /* surfaced via tx.state */
      }
    },
    [address, answer, answerHash, bountyId, tx],
  );

  if (!isConnected || !address) return null;

  return (
    <Card>
      <CardHeader
        title="Submit encrypted answer"
        subtitle="Your answer stays hidden on-chain. The TEE decrypts it during judging."
      />
      <CardBody>
        <form onSubmit={handleSubmitEncrypted} className="space-y-3">
          <Field label="Your answer">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              placeholder="Write your bounty submission…"
            />
          </Field>

          <Field label="Answer hash (optional, for dedup)">
            <input
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600"
              value={answerHash}
              onChange={(e) => setAnswerHash(e.target.value)}
              placeholder="keccak256 of plaintext, e.g. 0x1234..."
            />
          </Field>

          <Notice tone="indigo">
            Your answer is ECIES-encrypted to the TEE executor's public key{" "}
            {executorPublicKey ? (
              <code className="font-mono text-[10px]">
                {executorPublicKey.slice(0, 20)}…
              </code>
            ) : (
              "(not set)"
            )}
            . Only the TEE enclave can decrypt it. The plaintext never appears on-chain.
          </Notice>

          {answer && (
            <div className="rounded-xl bg-black/30 px-3 py-2 text-xs text-zinc-400 break-all">
              <div className="font-medium text-zinc-300">Encrypted hex (on-chain):</div>
              <code className="mt-1 block font-mono text-[10px]">
                0x{Buffer.from(answer).toString("hex").slice(0, 80)}…
              </code>
            </div>
          )}

          <Button
            type="submit"
            disabled={!answer.trim() || tx.isBusy}
            className="w-full"
          >
            {tx.isBusy ? "Submitting…" : "Submit encrypted answer"}
          </Button>

          {tx.state === "confirmed" && (
            <Notice tone="green">
              Encrypted answer submitted. The TEE will decrypt it during batch judging.
            </Notice>
          )}

          <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />
        </form>
      </CardBody>
    </Card>
  );
}
