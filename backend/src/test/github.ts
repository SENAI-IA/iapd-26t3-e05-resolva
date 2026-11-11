export function githubWorkflowRun() {
  return {
    id: 987654,
    html_url: "https://github.com/equipe/alvo/actions/runs/987654",
    workflow_id: 456,
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    head_sha: "b".repeat(40),
    repository: { full_name: "equipe/alvo" },
    display_title: "Resolva 11111111-1111-4111-8111-111111111111",
    created_at: "2026-11-11T00:00:00.000Z",
  };
}

export function githubPullRequest() {
  return {
    number: 12,
    html_url: "https://github.com/equipe/alvo/pull/12",
    state: "open",
    merged: false,
    draft: false,
    body: "Corrige o total.\n<!-- resolva-delivery:11111111-1111-4111-8111-111111111111 -->",
    head: {
      ref: "resolva/res-1-abc",
      sha: "a".repeat(40),
      repo: { full_name: "equipe/alvo" },
    },
    base: { ref: "main", repo: { full_name: "equipe/alvo" } },
  };
}

export function githubBranch() {
  return {
    ref: "refs/heads/resolva/res-1-abc",
    object: { type: "commit", sha: "a".repeat(40) },
  };
}
