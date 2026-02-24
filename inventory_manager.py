import csv
from pathlib import Path


CSV_FILE = Path("parts_inventory.csv")

ALIASES = {
    "position": "position",
    "item number": "item_number",
    "item_number": "item_number",
    "designation": "designation",
    "quantity": "quantity",
    "unit of quantity": "unit_of_quantity",
    "unit_of_quantity": "unit_of_quantity",
    "spare parts identifier": "spare_parts_identifier",
    "spare_parts_identifier": "spare_parts_identifier",
    "current stock": "current_stock",
    "current_stock": "current_stock",
    "minimum stock": "minimum_stock",
    "minimum_stock": "minimum_stock",
    "location": "location",
}

OUTPUT_FIELDS = [
    "position",
    "item_number",
    "designation",
    "quantity",
    "unit_of_quantity",
    "spare_parts_identifier",
    "current_stock",
    "minimum_stock",
    "location",
]


def to_int(value, default=0):
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return default


def normalize_row(row):
    normalized = {field: "" for field in OUTPUT_FIELDS}
    for key, value in row.items():
        if key is None:
            continue
        mapped = ALIASES.get(key.strip().lower())
        if mapped:
            normalized[mapped] = (value or "").strip()

    if not normalized["current_stock"]:
        normalized["current_stock"] = normalized["quantity"] or "0"
    if not normalized["minimum_stock"]:
        normalized["minimum_stock"] = "0"
    return normalized


def load_parts(csv_path=CSV_FILE):
    if not csv_path.exists():
        return []

    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [normalize_row(row) for row in reader]


def save_parts(parts, csv_path=CSV_FILE):
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(parts)


def find_part(parts, item_number):
    for part in parts:
        if part["item_number"] == item_number:
            return part
    return None


def print_parts(parts):
    if not parts:
        print("데이터가 없습니다.")
        return

    header = (
        f"{'Item No':<18} {'Designation':<28} {'Stock':>8} "
        f"{'Min':>8} {'Unit':<8} {'Location':<10}"
    )
    print(header)
    print("-" * len(header))
    for p in parts:
        print(
            f"{p['item_number']:<18} "
            f"{p['designation'][:28]:<28} "
            f"{to_int(p['current_stock']):>8} "
            f"{to_int(p['minimum_stock']):>8} "
            f"{p['unit_of_quantity']:<8} "
            f"{p['location']:<10}"
        )


def list_low_stock(parts):
    low = [
        p for p in parts
        if to_int(p["current_stock"]) <= to_int(p["minimum_stock"])
    ]
    print_parts(low)


def update_stock(parts, item_number, delta):
    part = find_part(parts, item_number)
    if not part:
        print(f"품목번호를 찾을 수 없습니다: {item_number}")
        return False

    current = to_int(part["current_stock"])
    new_stock = current + delta
    if new_stock < 0:
        print(f"출고 실패: 현재고({current})보다 많이 출고할 수 없습니다.")
        return False

    part["current_stock"] = str(new_stock)
    print(
        f"완료: {item_number} | {part['designation']} | "
        f"{current} -> {new_stock}"
    )
    return True


def set_part_info(parts, item_number, minimum_stock=None, location=None):
    part = find_part(parts, item_number)
    if not part:
        print(f"품목번호를 찾을 수 없습니다: {item_number}")
        return False

    if minimum_stock is not None:
        part["minimum_stock"] = str(to_int(minimum_stock))
    if location is not None:
        part["location"] = location.strip()
    print(f"수정 완료: {item_number}")
    return True


def print_menu():
    print("\n[재고관리 메뉴]")
    print("1. 전체 재고 조회")
    print("2. 부족 재고 조회 (현재고 <= 안전재고)")
    print("3. 입고 처리")
    print("4. 출고 처리")
    print("5. 품목 정보 수정 (안전재고/위치)")
    print("0. 종료")


def main():
    parts = load_parts()
    if not parts:
        print(
            "CSV 데이터가 없습니다. parts_inventory.csv 파일을 확인하세요.\n"
            "처음 실행이면 템플릿 파일에 데이터를 입력한 뒤 다시 실행하세요."
        )

    while True:
        print_menu()
        choice = input("선택: ").strip()

        if choice == "1":
            print_parts(parts)
        elif choice == "2":
            list_low_stock(parts)
        elif choice == "3":
            item_no = input("품목번호(item_number): ").strip()
            qty = to_int(input("입고 수량: ").strip(), default=0)
            if qty <= 0:
                print("입고 수량은 1 이상이어야 합니다.")
                continue
            if update_stock(parts, item_no, qty):
                save_parts(parts)
        elif choice == "4":
            item_no = input("품목번호(item_number): ").strip()
            qty = to_int(input("출고 수량: ").strip(), default=0)
            if qty <= 0:
                print("출고 수량은 1 이상이어야 합니다.")
                continue
            if update_stock(parts, item_no, -qty):
                save_parts(parts)
        elif choice == "5":
            item_no = input("품목번호(item_number): ").strip()
            min_stock = input("안전재고(비우면 유지): ").strip()
            location = input("보관위치(비우면 유지): ").strip()
            if set_part_info(
                parts,
                item_no,
                minimum_stock=min_stock if min_stock else None,
                location=location if location else None,
            ):
                save_parts(parts)
        elif choice == "0":
            print("종료합니다.")
            break
        else:
            print("올바른 메뉴 번호를 입력하세요.")


if __name__ == "__main__":
    main()
