"use client";

import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import bountyJudgeAbi from "@/abi/BountyJudge";
import { contractAddress, executorAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import type { Bounty } from "@/lib/bounty";
import { buildJudgeAllLlmInput, buildEncryptedJudgeAllLlmInput, type JudgeSubmission } from "@/lib/ritualLlm";
import { useWriteTx } from "@/hooks/useWriteTx";
import { useRitualWalletStatus } from "@/hooks/useRitualWalletStatus";
import { RitualWalletPanel } from "@/components/RitualWalletPanel";
import { Card, CardHeader, CardBody, Button, TxStatus, Notice, Spinner } from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

export function JudgeAll({
  bountyId,
  bounty,
  isOwner,
  isEncrypted,
  onJudged,
}: {
  bountyId: bigint;
  bounty: Bounty;
  isOwner: boolean;
  isEncrypted?: boolean;
  onJudged: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: ritualChain.id });
  const [gathering, setGathering] = useState(false);
  const [gatherError, setGatherError] = useState<string | null>(null);
  const tx = useWriteTx(() => onJudged());

  const walletStatus = useRitualWalletStatus(address);

  const count = Number(bounty.submissionCount);

  // Gate per spec: owner only, has submissions, not yet judged.
  if (!isOwner || bounty.judged || bounty.finalized) {
    return null;
  }

  async function handleJudge() {
    if (!publicClient || !contractAddress || !walletStatus.ready) return;
    setGatherError(null);
    setGathering(true);
    try {
      if (isEncrypted) {
        // ── Encrypted mode: gather encrypted submissions ──
        const encCount = await publicClient.readContract({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "getEncryptedSubmissionCount",
          args: [bountyId],
        });

        const submissions: JudgeSubmission[] = [];
        for (let i = 0; i < Number(encCount); i++) {
          const [submitter, encryptedAnswer, answerHash] =
            await publicClient.readContract({
              address: contractAddress,
              abi: bountyJudgeAbi,
              functionName: "getEncryptedSubmission",
              args: [bountyId, BigInt(i)],
            });
          submissions.push({
            index: i,
            submitter,
            answer: encryptedAnswer as unknown as string,
            isEncrypted: true,
            answerHash,
          });
        }

        const llmInput = buildEncryptedJudgeAllLlmInput({
          executorAddress,
          title: bounty.title,
          rubric: bounty.rubric,
          submissions,
        });

        setGathering(false);

        await tx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "judgeAll",
          args: [bountyId, llmInput],
          chainId: ritualChain.id,
        });
      } else {
        // ── Standard commit-reveal mode ──
        const submissions: JudgeSubmission[] = [];
        if (count === 0) {
          setGathering(false);
          setGatherError("No revealed submissions to judge.");
          return;
        }

        for (let i = 0; i < count; i++) {
          const [submitter, answer] = await publicClient.readContract({
            address: contractAddress,
            abi: bountyJudgeAbi,
            functionName: "getSubmission",
            args: [bountyId, BigInt(i)],
          });
          submissions.push({ index: i, submitter, answer });
        }

        const llmInput = buildJudgeAllLlmInput({
          executorAddress,
          title: bounty.title,
          rubric: bounty.rubric,
          submissions,
        });

        setGathering(false);

        await tx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "judgeAll",
          args: [bountyId, llmInput],
          chainId: ritualChain.id,
        });
      }
    } catch (e) {
      setGathering(false);
      setGatherError(
        (e as { shortMessage?: string; message?: string }).shortMessage ||
          (e as Error).message ||
          "Failed to gather submissions.",
      );
    }
  }

  const busy = gathering || tx.isBusy;
  const fundingReady = walletStatus.ready === true;

  return (
    <Card>
      <CardHeader
        title="Judge all submissions"
        subtitle={
          isEncrypted
            ? "Sends one Ritual LLM request — encrypted answers decrypted inside TEE."
            : "Sends one Ritual LLM request ranking every revealed submission."
        }
      />
      <CardBody className="space-y-3">
        <Notice tone="indigo">AI review is advisory. The bounty owner finalizes the winner.</Notice>

        {isEncrypted && (
          <Notice tone="amber">
            Encrypted mode: answers are decrypted inside the TEE enclave. The LLM prompt uses
            template substitution via encryptedSecrets.
          </Notice>
        )}

        <RitualWalletPanel status={walletStatus} onDeposited={walletStatus.refetch} />

        {count === 0 && !isEncrypted && (
          <Notice tone="red">
            No revealed submissions yet. Participants must reveal their answers after the deadline.
          </Notice>
        )}

        <Button onClick={handleJudge} disabled={busy || !fundingReady} className="w-full">
          {gathering ? (
            <>
              <Spinner /> Gathering submissions…
            </>
          ) : tx.isBusy ? (
            "Judging…"
          ) : !fundingReady ? (
            "Fund RitualWallet to judge"
          ) : isEncrypted ? (
            "Judge encrypted submissions"
          ) : (
            `Judge all (${count})`
          )}
        </Button>
        {gatherError && <Notice tone="red">{gatherError}</Notice>}
        <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />
      </CardBody>
    </Card>
  );
}
