import numpy as np
import torch
from sentence_transformers import SentenceTransformer

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"

QUERY_PREFIXES = {
    "BAAI/bge-small-en-v1.5": "Represent this sentence for searching relevant passages: ",
    "BAAI/bge-base-en-v1.5": "Represent this sentence for searching relevant passages: ",
    "BAAI/bge-large-en-v1.5": "Represent this sentence for searching relevant passages: ",
    "intfloat/e5-small-v2": "query: ",
    "intfloat/e5-base-v2": "query: ",
}
DOC_PREFIXES = {
    "intfloat/e5-small-v2": "passage: ",
    "intfloat/e5-base-v2": "passage: ",
}


class Embedder:
    """Local sentence-transformers embedder.

    Any sentence-transformers model can be swapped in by name; the prefix
    tables above keep query/document asymmetry correct per model family.
    """

    def __init__(self, model_name: str = DEFAULT_MODEL, device: str | None = None):
        self.model_name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = SentenceTransformer(model_name, device=self.device)
        self.dim = self.model.get_sentence_embedding_dimension()

    def embed_documents(self, texts: list[str], batch_size: int = 64) -> np.ndarray:
        prefix = DOC_PREFIXES.get(self.model_name, "")
        return self.model.encode(
            [prefix + t for t in texts],
            batch_size=batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

    def embed_query(self, text: str) -> np.ndarray:
        prefix = QUERY_PREFIXES.get(self.model_name, "")
        return self.model.encode(
            prefix + text,
            normalize_embeddings=True,
            show_progress_bar=False,
        )


_cache: dict[str, Embedder] = {}


def get_embedder(model_name: str = DEFAULT_MODEL) -> Embedder:
    """Cached accessor so a model is only loaded onto the GPU once."""
    if model_name not in _cache:
        _cache[model_name] = Embedder(model_name)
    return _cache[model_name]
