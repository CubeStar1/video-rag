import argparse
import os
import warnings

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
warnings.filterwarnings("ignore")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the FalconVQA server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8077)
    parser.add_argument("--reload", action="store_true", help="restart on code changes")
    parser.add_argument("--api-only", action="store_true",
                        help="serve the API without the web UI")
    args = parser.parse_args()

    if args.api_only:
        os.environ["VIDEOMIND_UI"] = "0"

    import uvicorn

    what = "API" if args.api_only else "API + UI"
    print(f"FalconVQA ({what}) -> http://{args.host}:{args.port}")
    if not args.api_only:
        print(f"  UI    http://{args.host}:{args.port}/")
    print(f"  docs  http://{args.host}:{args.port}/docs")

    uvicorn.run(
        "videomind.api.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
