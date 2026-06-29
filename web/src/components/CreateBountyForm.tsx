"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { parseEther, parseEventLogs } from "viem";
import { contractAddress, isContractConfigured } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import bountyJudgeAbi from "@/abi/BountyJudge";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

function defaultDeadline(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function CreateBountyForm({ onCreated }: { onCreated?: (bountyId: bigint) => void }) {
  const { isConnected } = useAccount();
  const [title, setTitle] = useState("");
  const [rubric, setRubric] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [reward, setReward] = useState("");
  const [createdId, setCreatedId] = useState<bigint | null>(null);

  // Encrypted bounty (Advanced Track) fields
  const [enableEncrypted, setEnableEncrypted] = useState(false);
  const [executorAddress, setExecutorAddress] = useState("");
  const [executorPubKey, setExecutorPubKey] = useState("");

  const tx = useWriteTx((receipt) => {
    try {
      const logs = parseEventLogs({
        abi: bountyJudgeAbi,
        eventName: "BountyCreated",
        logs: receipt.logs,
      });
      const id = logs[0]?.args?.bountyId;
      if (id !== undefined) {
        setCreatedId(id);
        onCreated?.(id);
      }
    } catch {
      /* not fatal */
    }
  });

  const validation = useMemo(() => {
    if (!title.trim()) return "Title is required.";
    if (!rubric.trim()) return "Rubric is required.";
    if (!deadline) return "Pick a deadline.";
    const ts = new Date(deadline).getTime();
    if (!Number.isFinite(ts)) return "Invalid deadline.";
    if (reward !== "") {
      try {
        parseEther(reward);
      } catch {
        return "Reward must be a valid number.";
      }
    }
    if (enableEncrypted) {
      if (!executorAddress.trim() || !/^0x[0-9a-fA-F]{40}$/.test(executorAddress.trim())) {
        return "Invalid executor address.";
      }
      if (!executorPubKey.trim()) return "Executor public key is required.";
    }
    return null;
  }, [title, rubric, deadline, reward, enableEncrypted, executorAddress, executorPubKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validation || !contractAddress) return;

    const deadlineMs = new Date(deadline).getTime();
    if (deadlineMs <= Date.now()) {
      window.alert("Deadline must be in the future.");
      return;
    }

    const deadlineTs = BigInt(Math.floor(deadlineMs / 1000));
    const value = reward.trim() === "" ? 0n : parseEther(reward.trim());
    setCreatedId(null);

    try {
      if (enableEncrypted) {
        const execAddr = executorAddress.trim() as `0x${string}`;
        const execKey = `0x${executorPubKey.trim().replace(/^0x/, "")}` as `0x${string}`;
        await tx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "createEncryptedBounty",
          args: [title.trim(), rubric.trim(), deadlineTs, execAddr, execKey],
          value,
          chainId: ritualChain.id,
        });
      } else {
        await tx.run({
          address: contractAddress,
          abi: bountyJudgeAbi,
          functionName: "createBounty",
          args: [title.trim(), rubric.trim(), deadlineTs],
          value,
          chainId: ritualChain.id,
        });
      }
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Create a bounty"
        subtitle="Fund a reward and define how submissions will be judged."
      />
      <CardBody>
        {!isContractConfigured && (
          <Notice tone="amber">
            Set <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code> in your{" "}
            <code className="font-mono">.env.local</code> to enable transactions.
          </Notice>
        )}

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Best gas-optimization writeup"
              maxLength={200}
            />
          </Field>

          <Field label="Rubric" hint="How submissions are scored. The AI judges only against this.">
            <Textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={4}
              placeholder="Correctness 50%, clarity 30%, novelty 20%…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Deadline">
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
            <Field label="Reward (RITUAL)" hint="Locked in the contract on create.">
              <Input
                type="number"
                min="0"
                step="any"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                placeholder="1.0"
              />
            </Field>
          </div>

          {/* Advanced Track: Encrypted Submissions toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enable-encrypted"
              checked={enableEncrypted}
              onChange={(e) => setEnableEncrypted(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
            />
            <label htmlFor="enable-encrypted" className="text-xs font-medium text-zinc-300">
              Enable encrypted submissions (Advanced Track)
            </label>
          </div>

          {enableEncrypted && (
            <div className="space-y-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-3">
              <Notice tone="indigo">
                Encrypted mode: answers are ECIES-encrypted with the TEE executor's public key.
                Only the TEE enclave can decrypt them during batch judging.
              </Notice>
              <Field label="TEE Executor Address" hint="From TEEServiceRegistry">
                <Input
                  value={executorAddress}
                  onChange={(e) => setExecutorAddress(e.target.value)}
                  placeholder="0x..."
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Executor Public Key (hex)" hint="ECIES public key for encryption">
                <Input
                  value={executorPubKey}
                  onChange={(e) => setExecutorPubKey(e.target.value)}
                  placeholder="04..."
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          )}

          {validation && (title || rubric || reward) ? (
            <p className="text-xs text-amber-300">{validation}</p>
          ) : null}

          <Button
            type="submit"
            disabled={!isConnected || !isContractConfigured || !!validation || tx.isBusy}
            className="w-full"
          >
            {tx.isBusy ? "Creating…" : enableEncrypted ? "Create encrypted bounty" : "Create bounty"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-zinc-500">Connect your wallet to create a bounty.</p>
          )}

          <TxStatus state={tx.state} error={tx.error} hash={tx.hash} explorerBase={explorerBase} />

          {createdId !== null && (
            <Notice tone="green">
              Bounty created with id{" "}
              <span className="font-mono font-semibold">#{createdId.toString()}</span>
              {enableEncrypted && " (encrypted mode)"}. Loaded below.
            </Notice>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
