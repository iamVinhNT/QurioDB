/** @file templates.ts @description Markdown authoring templates; all new documents stay drafts. */
import type { DocumentKind } from "./types";
export const templates: Record<DocumentKind, string> = {
  design:
    "# Thiết kế dữ liệu\n\n## Mục tiêu\n\n## Bảng và quan hệ\n\n## Grain và quy tắc JOIN\n\n## Quy tắc nghiệp vụ\n",
  dictionary:
    "# Từ điển dữ liệu\n\n## Thuật ngữ\n\n## Ý nghĩa bảng và cột\n\n## Giá trị đặc biệt\n",
  metric:
    "# Định nghĩa chỉ số\n\n## Công thức\n\n## Grain\n\n## Bộ lọc và thời gian\n\n## Ví dụ\n",
  rule: "# Quy tắc nghiệp vụ\n\n## Điều kiện\n\n## Cách áp dụng\n\n## Ngoại lệ\n",
  example:
    "# SQL mẫu đã kiểm chứng\n\n## Câu hỏi\n\n## SQL\n\n```sql\n\n```\n\n## Kết quả mong đợi\n",
  note: "# Ghi chú\n\n",
};
