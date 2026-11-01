from decimal import Decimal

JOB_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"

MAX_REFERENCE_COUNT = 4
MAX_SOURCE_BYTES_EACH = 16 * 1024 * 1024       # 16 MiB per reference file
MAX_SOURCE_BYTES_TOTAL = 48 * 1024 * 1024      # 48 MiB total source files
MAX_DECODED_PIXELS = 16_700_000                 # ~4096x4096 decompression guard
MAX_LONGEST_SIDE = 2048                         # downscale before base64
MAX_ENCODED_BYTES_EACH = 8 * 1024 * 1024       # 8 MiB per encoded reference
MAX_ENCODED_BYTES_TOTAL = 24 * 1024 * 1024     # 24 MiB total encoded

ALLOWED_REFERENCE_TYPES = frozenset({"JPEG", "PNG", "WEBP"})

MAX_CANDIDATE_COUNT = 8
DEFAULT_CANDIDATE_COUNT = 1

ALLOWED_FORMATS = frozenset({"webp", "png", "jpeg"})
LOSSY_FORMATS = frozenset({"webp", "jpeg"})
DEFAULT_FORMAT = "webp"
DEFAULT_QUALITY = 90
MIN_QUALITY = 1
MAX_QUALITY = 100

RATIO_TOLERANCE = 0.01

GEMINI_SUPPORTED_RATIOS = frozenset({"16:9", "1:1", "9:16", "4:3", "3:4"})
GEMINI_SUPPORTED_RESOLUTIONS = frozenset({"1K"})

ZERO_USD = Decimal("0")
