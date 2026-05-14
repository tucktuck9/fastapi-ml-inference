def on_starting(server):
    """
    Gunicorn server hook that runs in the master process before workers are forked.
    By loading the model here, we ensure it uses the OS Copy-on-Write mechanism 
    to share the memory footprint across all worker processes.
    """
    from config import EAGER_LOAD
    from main import manager

    if EAGER_LOAD:
        print("[startup] preloading model before fork...")
        try:
            manager.load_model()
        except Exception as exc:
            print(f"[startup] eager model load failed: {exc}")
