// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EWasteAudit: tamper-evident anchors for e-waste custody and dispatch plans
/// @notice Stores only hashes. Operational data stays off-chain.
contract EWasteAudit {
    address public admin;
    mapping(address => bool) public isAttestor;

    struct Anchor {
        bytes32 headHash;    // head of the off-chain SHA-256 event chain
        uint32  eventCount;  // number of events covered by this head
        uint64  anchoredAt;
        address attestor;
    }

    mapping(bytes32 => Anchor) public batchAnchors;   // key = keccak256(batchId)
    mapping(bytes32 => uint64) public planAnchoredAt; // planHash => timestamp

    event AttestorSet(address indexed account, bool allowed);
    event BatchHeadAnchored(bytes32 indexed batchKey, string batchId,
                            bytes32 headHash, uint32 eventCount, address indexed attestor);
    event PlanAnchored(bytes32 indexed planHash, bytes32 scenarioHash,
                       string runId, address indexed attestor);

    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlyAttestor() { require(isAttestor[msg.sender], "not attestor"); _; }

    constructor() {
        admin = msg.sender;
        isAttestor[msg.sender] = true;
        emit AttestorSet(msg.sender, true);
    }

    function setAttestor(address account, bool allowed) external onlyAdmin {
        isAttestor[account] = allowed;
        emit AttestorSet(account, allowed);
    }

    function anchorBatchHead(string calldata batchId, bytes32 headHash, uint32 eventCount)
        external onlyAttestor
    {
        require(headHash != bytes32(0), "empty hash");
        bytes32 key = keccak256(bytes(batchId));
        require(eventCount > batchAnchors[key].eventCount, "stale or replayed anchor");
        batchAnchors[key] = Anchor(headHash, eventCount, uint64(block.timestamp), msg.sender);
        emit BatchHeadAnchored(key, batchId, headHash, eventCount, msg.sender);
    }

    function anchorPlan(bytes32 planHash, bytes32 scenarioHash, string calldata runId)
        external onlyAttestor
    {
        require(planHash != bytes32(0), "empty hash");
        require(planAnchoredAt[planHash] == 0, "plan already anchored");
        planAnchoredAt[planHash] = uint64(block.timestamp);
        emit PlanAnchored(planHash, scenarioHash, runId, msg.sender);
    }

    function getBatchAnchor(string calldata batchId) external view returns (Anchor memory) {
        return batchAnchors[keccak256(bytes(batchId))];
    }
}