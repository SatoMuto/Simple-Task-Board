# Simple Task Board

Cloudflare Pages + Firebase Auth/Firestore の無料枠で動かす、一人でも、友人や家族とでも使える共有タスクボードです。

## セットアップ

1. Firebaseプロジェクトを作成する
2. AuthenticationでGoogleログインを有効化する
3. Firestore Databaseを作成する
4. `.env.example` を `.env.local` にコピーしてFirebase Web App設定を入れる
5. `firestore.rules` をFirebaseコンソールへ反映する

```bash
npm install
npm run dev
npm run build
```

Cloudflare Pagesでは、Build commandを `npm run build`、Build output directoryを `dist` にします。

## 無料運用メモ

- Cloudflare Pagesは静的配信だけに使います。
- FirebaseはGoogleログインとFirestoreだけに使います。
- Cloud Functions、Firebase Storage、外部AI APIは初期実装では使いません。
