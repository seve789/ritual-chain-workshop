// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrecompileConsumer} from "./utils/PrecompileConsumer.sol";

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
    function lockUntil(address) external view returns (uint256);
}

/**
 * @title BountyJudge — Commit-Reveal + Encrypted Submissions
 *
 * ═══════════════════════════════════════════════════════════════
 * REQUIRED TRACK: COMMIT-REVEAL BOUNTY
 * ═══════════════════════════════════════════════════════════════
 *
 * Participants submit only a commitment hash during the submission phase.
 * After the deadline, they reveal their answer + salt.
 * The contract verifies keccak256(answer, salt, msg.sender, bountyId)
 * matches the commitment. Only valid, revealed answers are eligible.
 *
 * Flow:
 *   1. Owner → createBounty(title, rubric, deadline) + reward
 *   2. Participant → submitCommitment(bountyId, commitment)
 *   3. After deadline → revealAnswer(bountyId, answer, salt)
 *   4. Owner → judgeAll(bountyId, llmInput)
 *   5. Owner → finalizeWinner(bountyId, winnerIndex)
 *
 * ═══════════════════════════════════════════════════════════════
 * ADVANCED TRACK: RITUAL-NATIVE HIDDEN SUBMISSIONS
 * ═══════════════════════════════════════════════════════════════
 *
 * Answers are ECIES-encrypted to the TEE executor's public key and stored
 * as opaque bytes. During judgeAll, encrypted answers are passed via the
 * LLM precompile's encryptedSecrets mechanism. Inside the TEE, the executor
 * decrypts all answers and the LLM judges them in a single batch call.
 * Plaintext answers NEVER exist on-chain.
 */

contract BountyJudge is PrecompileConsumer {
    // ─────────────────────────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────────────────────────

    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;
    uint256 public constant REVEAL_GRACE_PERIOD = 1 hours;

    uint256 public nextBountyId = 1;

    IRitualWallet public constant WALLET =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    // ─────────────────────────────────────────────────────────────────
    //  Structs
    // ─────────────────────────────────────────────────────────────────

    /// @dev A revealed answer stored only after hash verification
    struct Submission {
        address submitter;
        string answer;
    }

    /// @dev A stored commitment — the hash, not the plaintext
    struct Commitment {
        address submitter;
        bytes32 commitment;
        bool revealed;
    }

    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    /// @dev Encrypted submission for the advanced track
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
        // Commit-reveal data
        Commitment[] commitments;
        uint256 revealDeadline;
        // Encrypted mode data
        bool isEncrypted;
        address executor;
        bytes executorPublicKey;
        EncryptedSubmission[] encryptedSubmissions;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Mappings
    // ─────────────────────────────────────────────────────────────────

    mapping(uint256 => Bounty) public bounties;

    // ─────────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────────

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 deadline,
        bool isEncrypted
    );

    event CommitmentSubmitted(
        uint256 indexed bountyId,
        uint256 indexed commitmentIndex,
        address indexed submitter,
        bytes32 commitment
    );

    event AnswerRevealed(
        uint256 indexed bountyId,
        uint256 indexed commitmentIndex,
        uint256 indexed submissionIndex,
        address submitter
    );

    event EncryptedAnswerSubmitted(
        uint256 indexed bountyId,
        uint256 indexed encryptedIndex,
        address indexed submitter
    );

    event AllAnswersJudged(uint256 indexed bountyId, bytes aiReview);

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    // ─────────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────────

    modifier onlyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "not bounty owner");
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        require(bounties[bountyId].owner != address(0), "bounty not found");
        _;
    }

    modifier afterDeadline(uint256 bountyId) {
        require(block.timestamp >= bounties[bountyId].deadline, "submissions still open");
        _;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Bounty Creation
    // ─────────────────────────────────────────────────────────────────

    /// @notice Create a standard commit-reveal bounty
    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 deadline
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");

        bountyId = nextBountyId++;
        Bounty storage bounty = bounties[bountyId];

        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.deadline = deadline;
        bounty.winnerIndex = type(uint256).max;
        bounty.revealDeadline = deadline + REVEAL_GRACE_PERIOD;
        bounty.isEncrypted = false;

        emit BountyCreated(bountyId, msg.sender, title, msg.value, deadline, false);
    }

    /// @notice Create an encrypted-submission bounty (Advanced Track)
    function createEncryptedBounty(
        string calldata title,
        string calldata rubric,
        uint256 deadline,
        address executor,
        bytes calldata executorPublicKey
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");
        require(executor != address(0), "invalid executor");
        require(executorPublicKey.length > 0, "missing executor pubkey");

        bountyId = nextBountyId++;
        Bounty storage bounty = bounties[bountyId];

        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.deadline = deadline;
        bounty.winnerIndex = type(uint256).max;
        bounty.revealDeadline = deadline + REVEAL_GRACE_PERIOD;
        bounty.isEncrypted = true;
        bounty.executor = executor;
        bounty.executorPublicKey = executorPublicKey;

        emit BountyCreated(bountyId, msg.sender, title, msg.value, deadline, true);
    }

    // ═════════════════════════════════════════════════════════════════
    //  COMMIT-REVEAL FLOW (Required Track)
    // ═════════════════════════════════════════════════════════════════

    /// @notice Phase 1: Submit a commitment hash
    /// @dev commitment = keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(block.timestamp < bounty.deadline, "submissions closed");
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(!bounty.isEncrypted, "use submitEncryptedAnswer for encrypted bounties");
        require(bounty.commitments.length < MAX_SUBMISSIONS, "too many commitments");
        require(commitment != bytes32(0), "commitment cannot be empty");

        uint256 idx = bounty.commitments.length;
        bounty.commitments.push(Commitment({
            submitter: msg.sender,
            commitment: commitment,
            revealed: false
        }));

        emit CommitmentSubmitted(bountyId, idx, msg.sender, commitment);
    }

    /// @notice Phase 2: Reveal answer + salt to verify the commitment
    /// @dev Verifies keccak256(answer, salt, msg.sender, bountyId) == commitment
    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) afterDeadline(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(!bounty.isEncrypted, "use encrypted flow");
        require(block.timestamp <= bounty.revealDeadline, "reveal period expired");
        require(bytes(answer).length <= MAX_ANSWER_LENGTH, "answer too long");

        bool found = false;
        for (uint256 i = 0; i < bounty.commitments.length; i++) {
            Commitment storage c = bounty.commitments[i];
            if (c.submitter == msg.sender && !c.revealed) {
                bytes32 computed = keccak256(
                    abi.encodePacked(answer, salt, msg.sender, bountyId)
                );
                require(computed == c.commitment, "commitment mismatch");

                c.revealed = true;
                found = true;

                uint256 submissionIndex = bounty.submissions.length;
                bounty.submissions.push(Submission({
                    submitter: msg.sender,
                    answer: answer
                }));

                emit AnswerRevealed(bountyId, i, submissionIndex, msg.sender);
                break;
            }
        }
        require(found, "no unrevealed commitment found");
    }

    /// @notice View helper to compute the commitment hash
    function computeCommitmentHash(
        string calldata answer,
        bytes32 salt,
        address submitter,
        uint256 bountyId
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(answer, salt, submitter, bountyId));
    }

    // ═════════════════════════════════════════════════════════════════
    //  ENCRYPTED SUBMISSION FLOW (Advanced Track)
    // ═════════════════════════════════════════════════════════════════

    /// @notice Submit an ECIES-encrypted answer (decryptable only inside TEE)
    function submitEncryptedAnswer(
        uint256 bountyId,
        bytes calldata encryptedAnswer,
        string calldata answerHash
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.isEncrypted, "not an encrypted bounty");
        require(block.timestamp < bounty.deadline, "submissions closed");
        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(bounty.encryptedSubmissions.length < MAX_SUBMISSIONS, "too many submissions");
        require(encryptedAnswer.length > 0, "encrypted answer cannot be empty");
        require(encryptedAnswer.length <= 2048, "encrypted answer too large");

        uint256 idx = bounty.encryptedSubmissions.length;
        bounty.encryptedSubmissions.push(EncryptedSubmission({
            submitter: msg.sender,
            encryptedAnswer: encryptedAnswer,
            answerHash: answerHash
        }));

        emit EncryptedAnswerSubmitted(bountyId, idx, msg.sender);
    }

    // ═════════════════════════════════════════════════════════════════
    //  JUDGING
    // ═════════════════════════════════════════════════════════════════

    /// @notice Judge all submissions via the Ritual LLM precompile
    /// @dev For encrypted bounties, llmInput must pack encrypted answers
    ///      into encryptedSecrets with template placeholders in the prompt.
    ///      The TEE executor decrypts inside the enclave and substitutes.
    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(!bounty.judged, "already judged");
        require(!bounty.finalized, "already finalized");
        require(block.timestamp >= bounty.deadline, "submissions still open");

        if (bounty.isEncrypted) {
            require(bounty.encryptedSubmissions.length > 0, "no encrypted submissions");
        } else {
            require(bounty.submissions.length > 0, "no revealed submissions");
        }

        bytes memory output = _executePrecompile(
            LLM_INFERENCE_PRECOMPILE,
            llmInput
        );

        (
            bool hasError,
            bytes memory completionData,
            ,
            string memory errorMessage,

        ) = abi.decode(output, (bool, bytes, bytes, string, ConvoHistory));

        require(!hasError, errorMessage);

        bounty.judged = true;
        bounty.aiReview = completionData;

        emit AllAnswersJudged(bountyId, completionData);
    }

    // ═════════════════════════════════════════════════════════════════
    //  FINALIZATION
    // ═════════════════════════════════════════════════════════════════

    /// @notice Finalize the winner and send the reward
    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        require(bounty.judged, "not judged yet");
        require(!bounty.finalized, "already finalized");
        require(winnerIndex < bounty.submissions.length
            || winnerIndex < bounty.encryptedSubmissions.length,
            "invalid winner index"
        );

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner;
        if (bounty.isEncrypted) {
            winner = bounty.encryptedSubmissions[winnerIndex].submitter;
        } else {
            winner = bounty.submissions[winnerIndex].submitter;
        }

        uint256 reward = bounty.reward;
        bounty.reward = 0;

        (bool ok, ) = payable(winner).call{value: reward}("");
        require(ok, "payment failed");

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    // ═════════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═════════════════════════════════════════════════════════════════

    /// @notice Get bounty summary (compatible with original AIJudge interface)
    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint256 deadline,
            bool judged,
            bool finalized,
            uint256 submissionCount,
            uint256 winnerIndex,
            bytes memory aiReview
        )
    {
        Bounty storage bounty = bounties[bountyId];

        return (
            bounty.owner,
            bounty.title,
            bounty.rubric,
            bounty.reward,
            bounty.deadline,
            bounty.judged,
            bounty.finalized,
            bounty.submissions.length,
            bounty.winnerIndex,
            bounty.aiReview
        );
    }

    /// @notice Get a revealed submission (commit-reveal track)
    function getSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, string memory answer)
    {
        Bounty storage bounty = bounties[bountyId];
        require(index < bounty.submissions.length, "invalid index");
        Submission storage submission = bounty.submissions[index];
        return (submission.submitter, submission.answer);
    }

    /// @notice Get a commitment (view — never reveals answer)
    function getCommitment(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, bytes32 commitment, bool revealed)
    {
        Bounty storage bounty = bounties[bountyId];
        require(index < bounty.commitments.length, "invalid index");
        Commitment storage c = bounty.commitments[index];
        return (c.submitter, c.commitment, c.revealed);
    }

    /// @notice Get commitment count
    function getCommitmentCount(
        uint256 bountyId
    ) external view bountyExists(bountyId) returns (uint256) {
        return bounties[bountyId].commitments.length;
    }

    /// @notice Get an encrypted submission (advanced track)
    function getEncryptedSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, bytes memory encryptedAnswer, string memory answerHash)
    {
        Bounty storage bounty = bounties[bountyId];
        require(index < bounty.encryptedSubmissions.length, "invalid index");
        EncryptedSubmission storage e = bounty.encryptedSubmissions[index];
        return (e.submitter, e.encryptedAnswer, e.answerHash);
    }

    /// @notice Get encrypted submission count
    function getEncryptedSubmissionCount(
        uint256 bountyId
    ) external view bountyExists(bountyId) returns (uint256) {
        return bounties[bountyId].encryptedSubmissions.length;
    }

    /// @notice Get bounty metadata (including encrypted-specific fields)
    function getBountyMetadata(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            bool isEncrypted,
            address executor,
            bytes memory executorPublicKey,
            uint256 revealDeadline,
            uint256 commitmentCount,
            uint256 encryptedSubmissionCount,
            uint256 submissionCount
        )
    {
        Bounty storage bounty = bounties[bountyId];
        return (
            bounty.isEncrypted,
            bounty.executor,
            bounty.executorPublicKey,
            bounty.revealDeadline,
            bounty.commitments.length,
            bounty.encryptedSubmissions.length,
            bounty.submissions.length
        );
    }

    /// @notice Get the reveal deadline
    function getRevealDeadline(
        uint256 bountyId
    ) external view bountyExists(bountyId) returns (uint256) {
        return bounties[bountyId].revealDeadline;
    }

    receive() external payable {}
}
