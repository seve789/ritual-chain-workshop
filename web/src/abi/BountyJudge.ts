const abi = [
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "bountyId", type: "uint256" },
      { indexed: false, internalType: "bytes", name: "aiReview", type: "bytes" },
    ],
    name: "AllAnswersJudged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "bountyId", type: "uint256" },
      { indexed: true, internalType: "uint256", name: "commitmentIndex", type: "uint256" },
      { indexed: true, internalType: "uint256", name: "submissionIndex", type: "uint256" },
      { indexed: false, internalType: "address", name: "submitter", type: "address" },
    ],
    name: "AnswerRevealed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "bountyId", type: "uint256" },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
      { indexed: false, internalType: "string", name: "title", type: "string" },
      { indexed: false, internalType: "uint256", name: "reward", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "deadline", type: "uint256" },
      { indexed: false, internalType: "bool", name: "isEncrypted", type: "bool" },
    ],
    name: "BountyCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "bountyId", type: "uint256" },
      { indexed: true, internalType: "uint256", name: "commitmentIndex", type: "uint256" },
      { indexed: true, internalType: "address", name: "submitter", type: "address" },
      { indexed: false, internalType: "bytes32", name: "commitment", type: "bytes32" },
    ],
    name: "CommitmentSubmitted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "bountyId", type: "uint256" },
      { indexed: true, internalType: "uint256", name: "encryptedIndex", type: "uint256" },
      { indexed: true, internalType: "address", name: "submitter", type: "address" },
    ],
    name: "EncryptedAnswerSubmitted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "bountyId", type: "uint256" },
      { indexed: true, internalType: "uint256", name: "winnerIndex", type: "uint256" },
      { indexed: true, internalType: "address", name: "winner", type: "address" },
      { indexed: false, internalType: "uint256", name: "reward", type: "uint256" },
    ],
    name: "WinnerFinalized",
    type: "event",
  },

  // Constants
  {
    inputs: [], name: "MAX_ANSWER_LENGTH", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function",
  },
  {
    inputs: [], name: "MAX_SUBMISSIONS", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function",
  },
  {
    inputs: [], name: "REVEAL_GRACE_PERIOD", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function",
  },
  {
    inputs: [], name: "nextBountyId", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function",
  },

  // Read: bounties
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "bounties",
    outputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "string", name: "title", type: "string" },
      { internalType: "string", name: "rubric", type: "string" },
      { internalType: "uint256", name: "reward", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bool", name: "judged", type: "bool" },
      { internalType: "bool", name: "finalized", type: "bool" },
      { internalType: "bytes", name: "aiReview", type: "bytes" },
      { internalType: "uint256", name: "winnerIndex", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // Read: getBounty
  {
    inputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    name: "getBounty",
    outputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "string", name: "title", type: "string" },
      { internalType: "string", name: "rubric", type: "string" },
      { internalType: "uint256", name: "reward", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bool", name: "judged", type: "bool" },
      { internalType: "bool", name: "finalized", type: "bool" },
      { internalType: "uint256", name: "submissionCount", type: "uint256" },
      { internalType: "uint256", name: "winnerIndex", type: "uint256" },
      { internalType: "bytes", name: "aiReview", type: "bytes" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    name: "getBountyMetadata",
    outputs: [
      { internalType: "bool", name: "isEncrypted", type: "bool" },
      { internalType: "address", name: "executor", type: "address" },
      { internalType: "bytes", name: "executorPublicKey", type: "bytes" },
      { internalType: "uint256", name: "revealDeadline", type: "uint256" },
      { internalType: "uint256", name: "commitmentCount", type: "uint256" },
      { internalType: "uint256", name: "encryptedSubmissionCount", type: "uint256" },
      { internalType: "uint256", name: "submissionCount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "uint256", name: "index", type: "uint256" },
    ],
    name: "getCommitment",
    outputs: [
      { internalType: "address", name: "submitter", type: "address" },
      { internalType: "bytes32", name: "commitment", type: "bytes32" },
      { internalType: "bool", name: "revealed", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    name: "getCommitmentCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "uint256", name: "index", type: "uint256" },
    ],
    name: "getEncryptedSubmission",
    outputs: [
      { internalType: "address", name: "submitter", type: "address" },
      { internalType: "bytes", name: "encryptedAnswer", type: "bytes" },
      { internalType: "string", name: "answerHash", type: "string" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    name: "getEncryptedSubmissionCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    name: "getRevealDeadline",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "uint256", name: "index", type: "uint256" },
    ],
    name: "getSubmission",
    outputs: [
      { internalType: "address", name: "submitter", type: "address" },
      { internalType: "string", name: "answer", type: "string" },
    ],
    stateMutability: "view",
    type: "function",
  },

  // View helpers
  {
    inputs: [
      { internalType: "string", name: "answer", type: "string" },
      { internalType: "bytes32", name: "salt", type: "bytes32" },
      { internalType: "address", name: "submitter", type: "address" },
      { internalType: "uint256", name: "bountyId", type: "uint256" },
    ],
    name: "computeCommitmentHash",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function",
  },

  // Write: createBounty
  {
    inputs: [
      { internalType: "string", name: "title", type: "string" },
      { internalType: "string", name: "rubric", type: "string" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "createBounty",
    outputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "title", type: "string" },
      { internalType: "string", name: "rubric", type: "string" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "address", name: "executor", type: "address" },
      { internalType: "bytes", name: "executorPublicKey", type: "bytes" },
    ],
    name: "createEncryptedBounty",
    outputs: [{ internalType: "uint256", name: "bountyId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "bytes32", name: "commitment", type: "bytes32" },
    ],
    name: "submitCommitment",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "string", name: "answer", type: "string" },
      { internalType: "bytes32", name: "salt", type: "bytes32" },
    ],
    name: "revealAnswer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "bytes", name: "encryptedAnswer", type: "bytes" },
      { internalType: "string", name: "answerHash", type: "string" },
    ],
    name: "submitEncryptedAnswer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "bytes", name: "llmInput", type: "bytes" },
    ],
    name: "judgeAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "bountyId", type: "uint256" },
      { internalType: "uint256", name: "winnerIndex", type: "uint256" },
    ],
    name: "finalizeWinner",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export default abi;
