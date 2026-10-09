# History extraction

This repository replays the history reachable from Wisconsin main at `9d9fa9d84a730b53f433d4fa3ae8726adf57f676`, excluding every `content/` change. Commits that become empty are pruned. Mixed commits retain their non-content changes and original author, committer, timestamps and messages, subject to Git filter-repo commit-reference rewriting. Useful merge ancestry is preserved.

Filtering was performed in an independent clone with git-filter-repo v2.47.0:

```sh
python3 git-filter-repo --path content/ --invert-paths --prune-empty always --force
```

`wisconsin-commit-map.tsv` records original and replayed object IDs; a zero replayed ID indicates a removed commit. Original Wisconsin history is unchanged. Historical paths remain available through Git; current course content and source repositories are not included.
