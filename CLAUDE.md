Before beginning any coding work in this repo, always be sure to familiarize yourself completely and thoroughly with the project. 

Always thoroughly test the code to ensure changes have taken effect before going back to the user. This includes actually trying to run or build the full code (dev server).

Since there will often be multiple agents working on this project, please don't leave background server tests running, as it causes conflicts. 

There will likely be multiple AI agents (and people) working on this codebase at any given time. For that reason, it is essential that you implement any new features in a separate feature branch in a worktree. Worktrees should be stored in .worktrees. 

## Merging your branch back to main

1. Fetch latest main:
```bash
   git fetch origin
```

2. Rebase your branch onto main:
```bash
   git rebase origin/main
```
   Resolve any conflicts if they arise, then `git rebase --continue`.

3. Switch to main and fast-forward merge:
```bash
   git checkout main
   git merge <your-branch> --ff-only
```

4. Push:
```bash
   git push origin main
```

If `--ff-only` fails, another branch was merged first. Go back to step 1.

DO NOT MERGE TO MAIN UNTIL THE USER EXPLICITLY TELLS YOU TO
