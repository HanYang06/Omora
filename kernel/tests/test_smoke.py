import omora_kernel


def test_kernel_exposes_version() -> None:
    assert omora_kernel.__version__ == "0.1.0"
