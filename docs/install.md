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

Sağlayıcıyı `tbot config` ile seçin. Google Gemini (`gemini`), OpenAI (`openai`), Anthropic (`anthropic`) ve OpenRouter (`openrouter`) listenin başındadır; diğer seçenekler `tbot providers` ile görülebilir. Model menüden seçilir; gerektiğinde yalnızca API anahtarını yazarsınız. Her sağlayıcının kaydedilen API anahtarı ayrıdır.

Kaydedilmiş sağlayıcı anahtarı, sağlayıcıya özgü ortam değişkeninden ve ardından `TBOT_API_KEY` değerinden önce kullanılır. HTTP 401 alırsanız `/config` üzerinden anahtarı ve sağlayıcı erişimini kontrol edin. Etkileşimli iş akışları için [README](../README.md) içindeki `/goal`, `/plan` ve `/subagents` açıklamalarına bakın.

## MCP bağlantıları ve terminal görünümü

Etkileşimli oturumda `/mcp` menüsüyle Vercel veya Supabase bağlantısını yapılandırın. Token maskeli girilir ve API anahtarlarıyla aynı mekanizmada saklanır; token ve sağlayıcı yetkilerini siz sağlarsınız. Kayıtlı token, ilgili `VERCEL_TOKEN` veya `SUPABASE_ACCESS_TOKEN` ortam değişkeninden önceliklidir. Yerel bağlantıyı kaldırmak tokenı sağlayıcıda iptal etmez.

Vercel seçeneği, Vercel API tokenı kullanan T Bot yerel MCP adaptörüdür; yalnızca `list_projects`, `get_project` ve `list_deployments` salt okunur araçlarını sunar. Resmi hosted OAuth MCP değildir. Supabase seçeneği resmi uzak MCP sunucusuna PAT ile bağlanır; varsayılan salt okunurdur, istenirse sağlayıcı yetkileri dahilinde yazma modu seçilebilir. Her MCP araç çağrısı onay gerektirir; YOLO açıksa onaylar otomatik verilir. Salt okunur alt ajanlar MCP araçlarına erişmez. Gerçek servis bağlantıları bu sürüm için test edilmedi.

Başlangıçtaki logo ve piksel bot animasyonunu kapatmak için `TBOT_NO_ANIMATION` ortam değişkenini tanımlayın. `NO_COLOR`, renkleri kaldırarak piksel görünümünü tek renkli yapar.
