import json
import os

# Đường dẫn file JSON Overpass
input_file = "hue.json"  # file bạn đã tải xuống từ Overpass

# Thư mục lưu các file riêng
output_dir = "elements"
os.makedirs(output_dir, exist_ok=True)

# Đọc file JSON
with open(input_file, "r", encoding="utf-8") as f:
    data = json.load(f)

# Lặp qua từng element
for element in data.get("elements", []):
    element_id = element.get("id")
    
    if element_id is None:
        # Nếu không có id, bỏ qua
        continue
    
    # Dùng id làm tên file
    file_path = os.path.join(output_dir, f"{element_id}.json")
    
    # Ghi toàn bộ element ra file riêng
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(element, f, ensure_ascii=False, indent=2)

print(f"Đã lưu {len(data.get('elements', []))} file vào thư mục '{output_dir}'")
