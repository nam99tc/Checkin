# DMPW Check-in Web

Static web chấm công demo. Bấm 1 nút → POST 1 event checkin lên webhook DMPW
kèm ảnh checkin random của người đang chọn.

## Tính năng
- Lần đầu vào: nút **"Bạn là ai?"** → chọn trong danh sách user → lưu `localStorage`.
- Đã chọn: hiện tên + avatar + nút **"Chấm công"** → bắn 1 event cho đúng người đó.
- "Đổi người" để chọn lại.

## Cách hoạt động
POST multipart `faceImage` tới `https://api.duallmaster.com/cameras/webhook-ts-camera`
(`[AllowAnonymous]`, không cần token). Tên file mã hoá thông tin:

```
{cameraId}-{cardId}-{ddMMyyyyHHmmss}-{similarity}-2.jpg
```

Webhook parse tên file: `[0]`=cameraId, `[1]`=cardId → user, `[2]`=thời gian,
`[3]`=similarity (chèn `.` sau số đầu, vd `0950` → `0.950`). Match/ tạo EventLog.

Ảnh bundle sẵn trong `images/<key>/` (same-origin để đọc bytes re-upload; multipart
POST là CORS-safelisted nên `no-cors` vẫn tới server).

## Thêm user
Sửa `users.json`, thêm thư mục `images/<key>/01.jpg..NN.jpg`:
```json
{ "key": "luat", "name": "...", "cardId": "DC_xxxx", "cameraId": "45010001491119001", "similarity": "0950", "count": 15 }
```

## Deploy GitHub Pages
```bash
cd dmpw-checkin-web
git add -A && git commit -m "init dmpw check-in web"
# tạo repo PUBLIC trên github.com (vd: dmpw-checkin), rồi:
git remote add origin https://github.com/<user>/dmpw-checkin.git
git branch -M main
git push -u origin main
```
GitHub → repo → **Settings → Pages → Source: Deploy from branch → `main` / `/root`** → Save.
URL: `https://<user>.github.io/dmpw-checkin/` — mở được ở điện thoại khác mạng.
