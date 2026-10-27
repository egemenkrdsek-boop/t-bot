# Kurulum ve güncelleme

Node.js 20.3 veya üzeri, npm ve Git gereklidir. Özel depoya erişim yetkisi olan bir GitHub hesabıyla Git kimlik doğrulamasını yapılandırın. Son `main` sürümünü global kurmak veya güncellemek için:

```powershell
npm install --global git+https://github.com/egemenkrdsek-boop/t-bot.git
```

Kaynak kodundan kurmak için:

```powershell
git clone https://github.com/egemenkrdsek-boop/t-bot.git
cd t-bot
npm ci
npm run build
npm install --global .
```

Git üzerinden kurulumda `prepare` yaşam döngüsü derlemeyi çalıştırır.

Global kurulum, derlenmiş `dist` dosyalarını ve masaüstü aracı için `scripts` dizinini içerir. Kurulumdan sonra `tbot` komutu kullanılabilir. Komut bulunamazsa npm global çalıştırılabilir dosya dizininin PATH içinde olduğunu kontrol edin (`npm prefix -g`).

Güncellemek için depo klasöründe güncel değişiklikleri alın, ardından `npm ci`, `npm run build` ve `npm install --global .` adımlarını yeniden çalıştırın. Uygulama ayarları ve oturumları kullanıcı veri dizininde tutulur; bunları veya `.env` dosyalarını depoya eklemeyin.

Sağlayıcıyı `tbot config` ile seçin. Google Gemini (`gemini`), OpenAI (`openai`), Anthropic (`anthropic`) ve OpenRouter (`openrouter`) listenin başındadır; diğer seçenekler `tbot providers` ile görülebilir. Model kimliği serbest girilir ve her sağlayıcının kaydedilen API anahtarı ayrıdır.
