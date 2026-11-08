import pytest

from core.kernel import Kernel
from packages.store import Store, StorePlugin


def test_adding_an_item_makes_it_visible_in_items() -> None:
    store = Store()

    store.add("买牛奶")

    assert [item.title for item in store.items()] == ["买牛奶"]


def test_archiving_an_item_removes_it_from_items() -> None:
    store = Store()
    milk = store.add("买牛奶")
    store.add("写周报")

    store.archive(milk.id)

    assert [item.title for item in store.items()] == ["写周报"]


def test_archiving_an_unknown_item_says_which_id_is_missing() -> None:
    store = Store()

    with pytest.raises(LookupError, match="条目不存在: 42"):
        store.archive(42)


def test_ids_keep_counting_after_an_archive() -> None:
    store = Store()
    first = store.add("买牛奶")
    store.archive(first.id)

    second = store.add("写周报")
    third = store.add("看书")

    assert (second.id, third.id) == (2, 3)


def test_installing_the_plugin_makes_store_reachable_by_name() -> None:
    kernel = Kernel()

    kernel.install(StorePlugin())

    store = kernel.resolve("store")
    store.add("买牛奶")
    assert [item.title for item in store.items()] == ["买牛奶"]


def test_uninstalling_the_plugin_takes_the_store_away() -> None:
    kernel = Kernel()
    kernel.install(StorePlugin())

    kernel.uninstall("store")

    with pytest.raises(LookupError, match="服务未提供: store"):
        kernel.resolve("store")
