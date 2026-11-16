# Martwin

## Run Martwin on your computer

1. **Download Martwin.** [Download the ZIP file](https://github.com/enzeeo/martwin/archive/refs/heads/main.zip) and unzip it. If you already have the Martwin folder, use that folder. No Git commands needed.
2. **Set up Python.** [Install `uv` for your operating system](https://docs.astral.sh/uv/getting-started/installation/), then open your Martwin folder in a terminal:

   - **Mac or Linux:** Open a new Terminal window. Type `cd` followed by a space, drag the Martwin folder into the window, and press Enter.
   - **Windows:** Open the Martwin folder in File Explorer, click the address bar at the top, type `powershell`, and press Enter.

   Paste this command into the terminal and press Enter. It downloads Python if needed and sets up the app’s virtual environment (`.venv`). This may take a few minutes.

   ```sh
   uv sync --locked --no-dev --group indus --python 3.12
   ```

3. **Start Martwin.** Paste this command into the same terminal and press Enter:

   ```sh
   uv run --no-sync python -c "from getpass import getpass; import os, uvicorn; os.environ['OPENROUTER_API_KEY'] = getpass('OpenRouter API key: '); uvicorn.run('src.backend.web:app', host='127.0.0.1', port=8080)"
   ```

   When the terminal asks for the **OpenRouter API key**, copy it from the **Google Doc for judges**, paste it into the terminal, and press Enter. The key won’t appear on screen as you paste it.

4. **Open [Martwin at localhost:8080](http://localhost:8080)** in your browser. Keep the terminal open while you use Martwin. Press **Ctrl+C** in the terminal to stop it.

To find Earth matches, Martwin also needs the prepared scoring files. If you received them separately, put them in `data/scoring` inside the Martwin folder, with `manifest.json` directly inside `scoring`.

[Developer reference](docs/deployment-reference.md)
