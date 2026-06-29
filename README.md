# Privacy-Preserving AI Bounty Judge

A commit-reveal + encrypted-submission bounty system running on **Ritual Chain** (Chain ID: 1979). Submissions are hidden during the submission phase, preventing participants from copying others' ideas. The AI judges eligible entries after the deadline using Ritual's LLM precompile inside a TEE enclave.

---

## Table of Contents

1. [Lifecycle Overview](#lifecycle-overview)
2. [Required Track: Commit-Reveal Bounty](#required-track-commit-reveal-bounty)
3. [Advanced Track: Ritual-Native Hidden Submissions](#advanced-track-ritual-native-hidden-submissions)
4. [Contract Architecture](#contract-architecture)
5. [Frontend Architecture](#frontend-architecture)
6. [Test Plan](#test-plan)
7. [Reflection: Public vs Hidden vs AI vs Human](#reflection-what-should-be-public-what-should-stay-hidden-and-what-should-be-decided-by-ai-versus-by-a-human)
8. [Deployment](#deployment)
9. [File Reference](#file-reference)

---

## Lifecycle Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                          BOUNTY LIFECYCLE                          │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────┐              │
│  │                PHASE 1: Create                    │              │
│  │  Owner funds the bounty, sets deadline + rubric   │              │
│  └──────────────────────┬───────────────────────────┘              │
│                         │                                          │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────┐              │
│  │         PHASE 2: Commit (Standard Track)         │              │
│  │  Participants submit keccak256(answer,salt,addr, │              │
│  │  bountyId) — only the hash is stored on-chain    │              │
│  └──────────────────────┬───────────────────────────┘              │
│                         │                                          │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────┐              │
│  │         PHASE 2: Encrypted (Advanced Track)      │              │
│  │  Participants submit ECIES-encrypted answers —   │              │
│  │  opaque bytes on-chain, only TEE can decrypt     │              │
│  └──────────────────────┬───────────────────────────┘              │
│                         │                                          │
│  ──── DEADLINE ─────────┼────────────────────────────────────      │
│                         │                                          │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────┐              │
│  │         PHASE 3: Reveal (Standard Track)          │              │
│  │  Participants reveal answer+salt within the       │              │
│  │  grace period. Contract verifies the commitment.  │              │
│  └──────────────────────┬───────────────────────────┘              │
│                         │                                          │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────┐              │
│  │            PHASE 4: Judge All                     │              │
│  │  Owner triggers Ritual LLM precompile to rank     │              │
│  │  all revealed/decrypted submissions in one call.  │              │
│  │  For encrypted bounties, the TEE decrypts inside  │              │
│  │  the enclave — plaintext never hits the chain.    │              │
│  └──────────────────────┬───────────────────────────┘              │
│                         │                                          │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────┐              │
│  │            PHASE 5: Finalize                      │              │
│  │  Owner selects winnerIndex from AI review,        │              │
│  │  contract sends the reward.                       │              │
│  └──────────────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────────┘
```

---

## Required Track: Commit-Reveal Bounty

### How It Works

1. **Phase 1 — Create**: The bounty owner calls `createBounty(title, rubric, deadline)` with the reward in RITUAL. The contract sets a `revealDeadline = deadline + 1 hour` for the reveal window.

2. **Phase 2 — Commit**: Participants call `submitCommitment(bountyId, commitment)` where:
   ```
   commitment = keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
   ```
   Only the hash is stored on-chain. The answer and salt remain secret.

3. **Phase 3 — Reveal** (after deadline): Participants call `revealAnswer(bountyId, answer, salt)`. The contract computes `keccak256(answer, salt, msg.sender, bountyId)` and verifies it matches the stored commitment. Only valid revealed answers enter the submissions array.

4. **Phase 4 — Judge**: The owner calls `judgeAll(bountyId, llmInput)` which forwards the ABI-encoded LLM request to Ritual's `0x0802` precompile. The LLM judges all revealed answers in a single batch call.

5. **Phase 5 — Finalize**: The owner calls `finalizeWinner(bountyId, winnerIndex)` which sends the reward to the winning submitter.

### Key Security Properties

- **Pre-submission secrecy**: During the commit phase, no participant can see other entries because only hashes are stored.
- **Binding commitment**: A participant cannot change their answer after committing — the commitment hash binds them.
- **Reveal-grace period**: 1 hour after deadline for participants to reveal. After that, unrevealed commitments are forfeited.
- **Anti-copy**: Since answers are hidden until all commits are in, copying is impossible during submission.

---

## Advanced Track: Ritual-Native Hidden Submissions

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Encrypted Submission Flow                         │
│                                                                     │
│  ┌──────────┐    ECIES encrypt      ┌──────────────────────┐        │
│  │ User     │ ──────────────────→  │ On-Chain Storage      │        │
│  │ Answer   │  (executor pubkey)    │ (opaque bytes)        │        │
│  └──────────┘                      └──────────┬───────────┘        │
│                                                │                    │
│  ┌─────────────────────────────────────────────┴───────────────┐   │
│  │              judgeAll() → LLM Precompile 0x0802            │   │
│  │  Encrypted answers packed into encryptedSecrets array       │   │
│  │  Prompt uses ANSWER_0, ANSWER_1 template placeholders       │   │
│  └────────────────────────────┬───────────────────────────────┘   │
│                               │                                    │
│                               ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              TEE Executor (inside secure enclave)          │   │
│  │  1. Decrypts all encrypted answer blobs                    │   │
│  │  2. Substitutes template placeholders with real answers    │   │
│  │  3. Sends full prompt to LLM model                         │   │
│  │  4. Returns ranking to the contract (encrypted output)     │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────┐                                                      │
│  │ Winner   │ ← Only the winner index is revealed on-chain         │
│  │ Selected │   The answers themselves never land in plaintext.    │
│  └──────────┘                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Where Is What?

| Data | Location | Visibility |
|------|----------|------------|
| Encrypted answer blob | On-chain (`encryptedSubmissions[]`) | Opaque to everyone; only TEE can decrypt |
| Plaintext answer | Inside TEE enclave (transient) | Ephemeral; destroyed after judging |
| TEE executor private key | TEE secure storage | Only the enclave |
| AI review (winner index) | On-chain (`aiReview`) | Public after judging |
| Reward payout | On-chain (`finalizeWinner`) | Public on-chain |

### How the LLM Receives Submissions

The `judgeAll` function passes a 30-field ABI-encoded LLM precompile request. For encrypted mode:

1. The prompt uses template placeholders: `"ANSWER_0"`, `"ANSWER_1"`, etc.
2. Encrypted answer blobs are packed into the `encryptedSecrets` array
3. When the TEE executor processes the request, it:
   - Decrypts each blob using its private key
   - Replaces `ANSWER_0`, `ANSWER_1` with the real answers
   - Sends the complete prompt to the LLM model
   - Returns the AI ranking to the blockchain

This guarantees that **plaintext answers never appear on-chain at any point**.

### Backend Flow for Batch Judging

The owner (or an automated script) performs these off-chain steps before calling `judgeAll`:

1. Read all encrypted submissions from `getEncryptedSubmissionCount()` + `getEncryptedSubmission()`
2. Build the LLM precompile request with placeholders in the prompt
3. Pack encrypted answer blobs into `encryptedSecrets`
4. Call `judgeAll(bountyId, llmInput)` with the encoded request

---

## Contract Architecture

### File: `hardhat/contracts/BountyJudge.sol`

Inherits from `PrecompileConsumer` (provides precompile address constants + `_executePrecompile` helper).

### Key Structs

```solidity
struct Commitment {
    address submitter;
    bytes32 commitment;
    bool revealed;
}

struct Submission {
    address submitter;
    string answer;
}

struct EncryptedSubmission {
    address submitter;
    bytes encryptedAnswer;      // ECIES-encrypted to executor pubkey
    string answerHash;          // keccak256 of plaintext (for off-chain dedup)
}

struct Bounty {
    address owner;
    string title;
    string rubric;
    uint256 reward;
    uint256 deadline;
    bool judged;
    bool finalized;
    bytes aiReview;
    uint256 winnerIndex;
    Submission[] submissions;
    Commitment[] commitments;
    uint256 revealDeadline;
    bool isEncrypted;
    address executor;
    bytes executorPublicKey;
    EncryptedSubmission[] encryptedSubmissions;
}
```

### Key Functions

| Function | Track | Description |
|----------|-------|-------------|
| `createBounty(title, rubric, deadline)` | Both | Create a standard bounty |
| `createEncryptedBounty(title, rubric, deadline, executor, pubkey)` | Advanced | Create encrypted-mode bounty |
| `submitCommitment(bountyId, commitment)` | Standard | Phase 1: submit hash |
| `revealAnswer(bountyId, answer, salt)` | Standard | Phase 2: verify and reveal |
| `submitEncryptedAnswer(bountyId, encrypted, hash)` | Advanced | Submit ECIES-encrypted answer |
| `judgeAll(bountyId, llmInput)` | Both | Batch judge via LLM precompile |
| `finalizeWinner(bountyId, winnerIndex)` | Both | Send reward to winner |

### Events

- `BountyCreated(uint256 bountyId, address owner, string title, uint256 reward, uint256 deadline, bool isEncrypted)`
- `CommitmentSubmitted(uint256 bountyId, uint256 commitmentIndex, address submitter, bytes32 commitment)`
- `AnswerRevealed(uint256 bountyId, uint256 commitmentIndex, uint256 submissionIndex, address submitter)`
- `EncryptedAnswerSubmitted(uint256 bountyId, uint256 encryptedIndex, address submitter)`
- `AllAnswersJudged(uint256 bountyId, bytes aiReview)`
- `WinnerFinalized(uint256 bountyId, uint256 winnerIndex, address winner, uint256 reward)`

---

## Frontend Architecture

### File Structure

```
web/src/
├── abi/
│   └── BountyJudge.ts          — Contract ABI with all new functions
├── components/
│   ├── BountyView.tsx           — Main bounty display (detects encrypted mode)
│   ├── BountyDetail.tsx         — Bounty metadata (unchanged)
│   ├── CommitAnswer.tsx         — Two-phase commit-reveal UI
│   ├── CreateBountyForm.tsx     — Supports both standard + encrypted creation
│   ├── EncryptedSubmission.tsx  — UI for submitting encrypted answers
│   ├── JudgeAll.tsx             — Updated to handle encrypted submissions
│   └── [other existing components]
└── lib/
    ├── bounty.ts                — Updated with canCommit/canReveal helpers
    └── ritualLlm.ts             — Added buildEncryptedJudgeAllLlmInput()
```

### Component Responsibilities

- **CreateBountyForm**: Toggle between standard and encrypted mode. In encrypted mode, executor address and public key fields appear.
- **CommitAnswer**: Two-phase UI. Phase 1 submits the hash commitment. Phase 2 reveals answer+salt after deadline. Displays the computed commitment hash in real-time.
- **EncryptedSubmission**: Accepts plaintext answer, displays the simulated encrypted hex. In production, this component would ECIES-encrypt client-side.
- **JudgeAll**: Detects encrypted bounties and uses `getEncryptedSubmissionCount()` + `buildEncryptedJudgeAllLlmInput()` instead of the standard path.
- **BountyView**: Reads `getBountyMetadata()` to determine if bounty is encrypted, routes to the correct submission component.

---

## Test Plan

### Commit-Reveal Test Cases

All tests in `hardhat/test/BountyJudge.t.sol`:

| Test | Scenario | Expected |
|------|----------|----------|
| `test_CreateBounty` | Owner creates bounty with reward | Bounty stored correctly; correct owner, title, reward, deadline |
| `test_CreateBountyFailsWithoutReward` | Create bounty with 0 value | Reverts "reward required" |
| `test_CreateBountyRevealDeadline` | Check reveal deadline is set | `revealDeadline = deadline + 1 hour` |
| `test_SubmitCommitment` | Submit a valid commitment hash | Commitment stored; submitter, hash, revealed=false |
| `test_SubmitCommitmentBeforeDeadline` | Commit before deadline | Succeeds |
| `test_SubmitCommitmentAfterDeadlineReverts` | Commit after deadline | Reverts "submissions closed" |
| `test_SubmitCommitmentEmptyReverts` | Submit bytes32(0) | Reverts "commitment cannot be empty" |
| `test_SubmitMultipleCommitments` | Alice + Bob commit | Both stored; correct counts |
| `test_SubmitCommitmentMaxReached` | 11th commit at MAX=10 | Reverts "too many commitments" |
| `test_RevealAnswerWithCorrectSalt` | Reveal with correct answer+salt | Submission stored; commitment.marked=true |
| `test_RevealWithWrongSaltReverts` | Reveal with wrong salt | Reverts "commitment mismatch" |
| `test_RevealWithWrongAnswerReverts` | Reveal with wrong answer | Reverts "commitment mismatch" |
| `test_RevealByDifferentAddressReverts` | Bob tries to reveal Alice's | Reverts "no unrevealed commitment found" |
| `test_RevealBeforeDeadlineReverts` | Reveal during commit phase | Reverts "submissions still open" |
| `test_RevealAfterRevealDeadlineReverts` | Reveal after deadline+1h | Reverts "reveal period expired" |
| `test_RevealOnlyOnce` | Reveal same commitment twice | Second reverts "no unrevealed commitment found" |
| `test_MultipleUsersCommitAndReveal` | Alice + Bob commit and reveal | Both submissions stored correctly |
| `test_ComputeCommitmentHash` | Call computeCommitmentHash helper | Returns correct keccak256 |
| `test_FinalizeWinner` | Complete flow: create→commit→reveal→finalize | Reward sent; winner detected |

### Encrypted Submission Test Cases

| Test | Scenario | Expected |
|------|----------|----------|
| `test_CreateEncryptedBounty` | Create with executor+pubkey | isEncrypted=true; executor+pubkey stored |
| `test_SubmitEncryptedAnswer` | Submit encrypted answer | EncryptedSubmission stored; count incremented |
| `test_EncryptedSubmissionFailsOnPlainBounty` | Submit encrypted to standard bounty | Reverts "not an encrypted bounty" |

### Edge Cases to Test

- **What if a participant commits but never reveals?** — Their commitment stays `revealed=false`. They don't appear in submissions. The bounty can still be judged with only revealed entries.
- **What if all participants forget to reveal?** — `judgeAll` will revert with "no revealed submissions". Owner must wait for reveals.
- **What if the owner never judges?** — Funds stay locked in the contract. Participants cannot withdraw.
- **What if the TEE executor is down (encrypted mode)?** — The judgeAll LLM call will fail. Owner can retry with a different executor.
- **What if the reveal deadline passes with un-revealed commitments?** — Those commitments are forfeited. The bounty owner can proceed with only revealed submissions.

---

## Reflection: What Should Be Public, What Should Stay Hidden, and What Should Be Decided by AI Versus by a Human in a Bounty System?

In a bounty system, **what should be public** includes the bounty parameters (title, rubric, reward, deadline), the winner announcement, and the payout transaction. These elements create trust and transparency — participants know what they're competing for, and observers can verify the outcome. The fact that a submission exists (its hash) is also necessarily public during the commit phase, though the content remains hidden.

**What should stay hidden** is the content of submissions until judging is complete. This is the core problem our commit-reveal and encrypted submission systems solve. Participants should not be able to see competitors' answers before submitting their own. In the advanced track, submissions remain hidden even from the contract itself — only the TEE enclave sees plaintext answers. After judging, only the winner's identity and the AI's ranking are revealed, but losing answers can remain private if the protocol is designed that way.

**What should be decided by AI** is the ranking and scoring of submissions against the rubric. The LLM can evaluate correctness, clarity, and creativity consistently and at scale. Ritual's TEE execution guarantees that the judging process is verifiable and that the AI's reasoning is auditable. The AI provides an advisory ranking (winnerIndex, summary) but does not control funds.

**What should be decided by a human** is the final winner selection and fund distribution. The bounty owner retains ultimate authority — the AI review is advisory. This human-in-the-loop design prevents edge cases where an AI might hallucinate a ranking or be gamed by prompt injection. The owner can also adjudicate edge cases that the rubric doesn't cover, such as disqualifying a submission that violates the spirit of the contest. Finally, the human decides if and when to trigger the AI judge, preventing automated exploits.

---

## Deployment

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- A funded wallet on Ritual Chain (Chain ID 1979)

### Deploy Contract

```bash
cd hardhat
pnpm install

# Set deployer private key
npx hardhat vars set DEPLOYER_PRIVATE_KEY <your_private_key>

# Deploy to Ritual Chain
npx hardhat ignition deploy ignition/modules/BountyJudge.ts --network ritual
```

### Configure Frontend

```bash
cd web
pnpm install
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=<deployed_BountyJudge_address>
NEXT_PUBLIC_RITUAL_RPC_URL=https://rpc.ritualfoundation.org
NEXT_PUBLIC_RITUAL_CHAIN_ID=1979
NEXT_PUBLIC_RITUAL_EXECUTOR_ADDRESS=<TEE_executor_from_registry>
```

```bash
pnpm dev
```

### Run Tests

```bash
cd hardhat
pnpm hardhat test solidity
# Specific test file:
pnpm hardhat test solidity --grep "Reveal"
```

---

## File Reference

```
bounty-judge/
├── README.md                           ← This file
├── hardhat/
│   ├── contracts/
│   │   ├── BountyJudge.sol             ← Main contract (commit-reveal + encrypted)
│   │   └── utils/PrecompileConsumer.sol ← Precompile helper (unchanged)
│   ├── test/
│   │   └── BountyJudge.t.sol           ← Comprehensive Solidity tests
│   ├── ignition/modules/
│   │   └── BountyJudge.ts              ← Ignition deploy module
│   ├── hardhat.config.ts
│   └── package.json
└── web/
    ├── src/
    │   ├── abi/
    │   │   └── BountyJudge.ts          ← Full ABI with all new functions
    │   ├── components/
    │   │   ├── BountyView.tsx          ← Updated: routes to commit/encrypted
    │   │   ├── CommitAnswer.tsx        ← NEW: two-phase commit-reveal UI
    │   │   ├── EncryptedSubmission.tsx  ← NEW: encrypted submission UI
    │   │   ├── CreateBountyForm.tsx    ← Updated: encrypted toggle
    │   │   └── JudgeAll.tsx            ← Updated: encrypted support
    │   └── lib/
    │       ├── bounty.ts               ← Updated: canCommit/canReveal
    │       └── ritualLlm.ts            ← Updated: encrypted LLM input builder
    └── .env.example
```
