import sys
import subprocess
import argparse

def main():
    """
    Parse command-line arguments and start the Hypha server.
    """
    parser = argparse.ArgumentParser(description="Start the Hypha server")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--public-base-url", type=str, default="")
    args = parser.parse_args()

    command = [
        sys.executable,
        "-m",
        "hypha.server",
        f"--host={args.host}",
        f"--port={args.port}",
        f"--public-base-url={args.public_base_url}",
        "--startup-functions=src.backend.main:setup"
    ]
    subprocess.run(command, check=True)

if __name__ == "__main__":
    main()
