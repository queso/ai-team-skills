# GitHub API Reference for PR Feedback

Quick reference for the `gh` CLI commands and API response shapes used by this skill.

## Fetching Inline Review Comments

Inline comments are attached to specific lines in the diff.

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
```

Response shape (array):

```json
[
  {
    "id": 1234567,
    "node_id": "PRR_kwDOABC123",
    "body": "This should handle the null case.",
    "path": "src/parser.ts",
    "line": 42,
    "original_line": 40,
    "diff_hunk": "@@ -38,6 +38,10 @@ function parse(input) {\n ...",
    "user": {
      "login": "reviewer1",
      "type": "User"
    },
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z",
    "in_reply_to_id": null
  },
  {
    "id": 1234568,
    "node_id": "PRR_kwDOABC124",
    "body": "Good point, I'll fix that.",
    "path": "src/parser.ts",
    "line": 42,
    "user": {
      "login": "pr-author",
      "type": "User"
    },
    "created_at": "2025-01-15T11:00:00Z",
    "in_reply_to_id": 1234567
  }
]
```

Key fields:

- `in_reply_to_id` — non-null means this is a reply in a thread; group with the parent
- `user.type` — `"Bot"` for automated comments, `"User"` for humans
- `path` + `line` — the file and line the comment is attached to
- `diff_hunk` — surrounding diff context for understanding what code is being discussed

## Fetching Conversation Comments

General comments on the PR conversation tab (not attached to code lines).

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --paginate
```

Response shape (array):

```json
[
  {
    "id": 9876543,
    "body": "Overall this looks good, but please add error handling for the API timeout case.",
    "user": {
      "login": "reviewer2",
      "type": "User"
    },
    "created_at": "2025-01-15T14:00:00Z"
  }
]
```

Note: PR conversation comments use the **issues** endpoint, not the pulls endpoint.

## Fetching Review Summaries

Reviews with an overall verdict (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`).

```bash
gh pr view {number} --json body,reviews,author
```

Response shape:

```json
{
  "body": "This PR adds null-safe parsing...",
  "author": {
    "login": "pr-author"
  },
  "reviews": [
    {
      "author": {
        "login": "reviewer1"
      },
      "body": "A few things to address before merging.",
      "state": "CHANGES_REQUESTED",
      "submittedAt": "2025-01-15T10:00:00Z"
    },
    {
      "author": {
        "login": "reviewer2"
      },
      "body": "",
      "state": "APPROVED",
      "submittedAt": "2025-01-16T09:00:00Z"
    }
  ]
}
```

Focus on reviews with `state: "CHANGES_REQUESTED"` — these contain actionable feedback in the `body` field. `APPROVED` reviews with empty bodies can be skipped.

## Detecting the PR Owner and Repo

```bash
gh repo view --json owner,name --jq '.owner.login + "/" + .name'
# Output: "owner/repo"
```

## Detecting PR State

```bash
gh pr view {number} --json state --jq '.state'
# Output: "OPEN", "CLOSED", or "MERGED"
```

## Replying to Inline Review Comments

Reply directly in an existing review comment thread using the comment ID:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="Fixed in abc1234. Added null check and a test for the empty input case."
```

This posts a reply that appears in the same thread as the original inline comment. Use the `id` field from the original comment (the numeric ID, not `node_id`).

## Replying to Conversation-Level Comments

For comments on the PR conversation tab (fetched from the issues endpoint), reply by posting a new issue comment:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="Addressed — see abc1234 for the fix and the new test coverage."
```

This appears as a new comment in the conversation tab. There is no threading for issue-level comments, so reference the original comment or reviewer to make it clear what you're responding to.

## Resolving Review Threads

Thread resolution uses the GraphQL API. You need the thread's node ID.

### Step 1: Get the thread ID from a comment

Each inline review comment has a `node_id` field. Use it to look up the parent thread:

```bash
gh api graphql -f query='
  query {
    node(id: "PRR_kwDOABC123") {
      ... on PullRequestReviewComment {
        pullRequestReviewThread {
          id
          isResolved
        }
      }
    }
  }
'
```

Response:

```json
{
  "data": {
    "node": {
      "pullRequestReviewThread": {
        "id": "PRRT_kwDOABC456",
        "isResolved": false
      }
    }
  }
}
```

### Step 2: Resolve the thread

```bash
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "PRRT_kwDOABC456"}) {
      thread {
        isResolved
      }
    }
  }
'
```

Response:

```json
{
  "data": {
    "resolveReviewThread": {
      "thread": {
        "isResolved": true
      }
    }
  }
}
```

### Batch resolution

To resolve multiple threads efficiently, you can combine mutations:

```bash
gh api graphql -f query='
  mutation {
    t1: resolveReviewThread(input: {threadId: "PRRT_id1"}) {
      thread { isResolved }
    }
    t2: resolveReviewThread(input: {threadId: "PRRT_id2"}) {
      thread { isResolved }
    }
    t3: resolveReviewThread(input: {threadId: "PRRT_id3"}) {
      thread { isResolved }
    }
  }
'
```

This resolves all threads in a single API call.

## Creating Issues

```bash
gh issue create \
  --title "Refactor: Extract factory for widget creation" \
  --body "From PR #42 review by @reviewer2:

> Consider using a factory pattern here to reduce coupling.

This was identified during code review but is out of scope for the current PR. Deferring to a dedicated refactor."
```

The command returns the issue URL on success.

## Pagination

All `gh api` calls should use `--paginate` to handle PRs with many comments. Without it, only the first page (typically 30 items) is returned.

## Filtering with jq

Extract only unresolved comments from a specific user:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate \
  --jq '[.[] | select(.user.type != "Bot")]'
```

Get just the comment bodies and authors:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate \
  --jq '.[] | {id: .id, body: .body, author: .user.login, path: .path, line: .line, reply_to: .in_reply_to_id}'
```
