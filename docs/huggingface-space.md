# Host Martwin on a Hugging Face Space

This puts Martwin online at a public link (for example
`https://enzeeoai-martwin.hf.space`). Visitors don't need an API key or any
setup. The OpenRouter key stays hidden on the server.

You'll do three things:

1. Upload the prepared scoring data to a private Hugging Face dataset.
2. Create a Space and give it the secrets it needs.
3. Upload the Martwin code. Hugging Face builds and starts it for you.

Plan on about an hour the first time, mostly waiting for uploads and the build.

## Before you start

- A Hugging Face account. You already have `enzeeoai`.
- The `hf` command-line tool, which is already installed on this Mac.
- Your prepared scoring bundle: the folder that has `manifest.json` directly
  inside it. This is the same folder you'd put at `data/scoring` to run Martwin
  locally.
- Your OpenRouter API key.

Run every command below in a terminal opened in the Martwin folder.

## Step 1: Log in to Hugging Face from the terminal

1. Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
2. Choose **Create new token**, choose the **Write** type, name it something
   like `martwin-upload`, and copy it.
3. Run:

   ```sh
   hf auth login
   ```

   Paste the token when asked. Answer **No** if it asks to add the token as a git
   credential.

4. Check that it worked:

   ```sh
   hf auth whoami
   ```

   It should print `enzeeoai`.

## Step 2: Upload the scoring data

The bundle can contain links that point into an older "base" bundle. Hugging
Face needs real files, so first make a copy with every link replaced by the file
it points to. Replace `/path/to/scoring-bundle` with your bundle folder:

```sh
cp -RL /path/to/scoring-bundle ~/martwin-scoring-upload
```

Check the size and that `manifest.json` sits at the top level:

```sh
du -sh ~/martwin-scoring-upload
ls ~/martwin-scoring-upload/manifest.json
```

Upload it as a **private** dataset. If the dataset doesn't exist yet, this
command creates it:

```sh
hf upload enzeeoai/martwin-scoring ~/martwin-scoring-upload . --repo-type dataset --private
```

Several GB can take a while to upload. If the upload stops partway, run the same
command again and it picks up where it left off. When it's done, open
[huggingface.co/datasets/enzeeoai/martwin-scoring](https://huggingface.co/datasets/enzeeoai/martwin-scoring)
and check that `manifest.json` is listed at the top level.

## Step 3: Create the Space

1. Go to [huggingface.co/new-space](https://huggingface.co/new-space).
2. Fill in:
   - **Space name:** `martwin`
   - **SDK:** **Docker**, then the **Blank** template
   - **Hardware:** **CPU basic** (the free tier)
   - **Visibility:** **Public**, so anyone with the link can use it
3. Choose **Create Space**. It will show an empty page for now. That's expected.

## Step 4: Add the secrets

In the Space, open **Settings** and scroll to **Variables and secrets**.

Add these with **New secret**. Secrets are hidden, so nobody can read them,
including visitors:

| Name | Value |
|---|---|
| `OPENROUTER_API_KEY` | Your OpenRouter key |
| `HF_TOKEN` | A **Read** token from [your token settings](https://huggingface.co/settings/tokens), so the Space can download the private dataset |

Add these with **New variable**. Variables are visible, which is fine for
these values:

| Name | Value |
|---|---|
| `MARTWIN_DATA_REPO` | `enzeeoai/martwin-scoring` |
| `OPENROUTER_MODEL` | Optional. Only add it to override the default model |

Then set a spending limit on the OpenRouter key: on
[openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), edit the key
and set a credit limit. Every visitor's search uses your credits, so this caps
what a busy day can cost.

## Step 5: Upload the Martwin code

These commands upload only the files the Space needs. The last one uploads the
Space's settings page as its `README.md`. This file is separate from Martwin's
own README, which stays unchanged.

```sh
hf upload enzeeoai/martwin Dockerfile Dockerfile --repo-type space
hf upload enzeeoai/martwin pyproject.toml pyproject.toml --repo-type space
hf upload enzeeoai/martwin uv.lock uv.lock --repo-type space
hf upload enzeeoai/martwin src src --repo-type space --exclude "**/__pycache__/**"
hf upload enzeeoai/martwin deploy deploy --repo-type space
hf upload enzeeoai/martwin deploy/space-README.md README.md --repo-type space
```

These only write to the Space on Hugging Face. They don't touch the GitHub repo
or any of its branches.

## Step 6: Watch it build and open it

1. Open [huggingface.co/spaces/enzeeoai/martwin](https://huggingface.co/spaces/enzeeoai/martwin).
   The status badge says **Building**. Choose **Logs** to watch.
2. The first build takes about 10–20 minutes because it installs PyTorch and
   bakes the INDUS encoder into the image.
3. Once it's built, the container downloads the scoring data. Look for
   `Scoring bundle ready.` in the logs, followed by `Uvicorn running`.
4. The status changes to **Running** and the app appears. Do a full search to
   check it end to end: pick a location, select features, then find Earth matches.

Your public link is `https://enzeeoai-martwin.hf.space`.

## Updating it later

After you change the code, re-run the Step 5 commands for the files you changed.
The Space rebuilds on its own. To change a secret, edit it in **Settings**. The
Space restarts by itself.

## If something goes wrong

| What you see | What to do |
|---|---|
| Build fails | Open **Logs** and look at the first red error line. |
| `has no manifest.json at its root` | The dataset has an extra folder level. Re-upload with `manifest.json` at the top level. |
| `401` or `Repository Not Found` while downloading | Check that `HF_TOKEN` is set and that `MARTWIN_DATA_REPO` is spelled exactly right. |
| Feature selection fails right away | Check the `OPENROUTER_API_KEY` secret and that the key still has credit. |
| Scoring returns 503 | The scoring data didn't load. Look in the logs for the download step. |
| First visit after a few days is slow | Free Spaces sleep after about 48 hours without visitors, and waking up means downloading the data again. Upgrading the hardware or adding persistent storage in **Settings** avoids this. |
| Out of memory | Try a larger hardware tier in **Settings**. |
