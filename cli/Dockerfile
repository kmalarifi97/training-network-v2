FROM python:3.12-slim

WORKDIR /cli
COPY pyproject.toml README.md ./
COPY gpunet_cli ./gpunet_cli
COPY skills ./skills

RUN pip install --no-cache-dir -e ".[dev]"

ENTRYPOINT ["gpunet"]
