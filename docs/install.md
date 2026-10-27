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

Etkileşimli oturumda `/mcp` menüsünden Vercel, Supabase veya GitHub bağlantısını kurun, yenileyin veya yerel kaydını kaldırın. Token maskeli girilir ve API anahtarlarıyla aynı mekanizmada saklanır; tokenı ve sağlayıcı yetkilerini siz sağlarsınız. Kayıtlı token ilgili ortam değişkeninden önce kullanılır: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, GitHub için `GITHUB_PERSONAL_ACCESS_TOKEN`, ardından `GITHUB_TOKEN`. Yerel bağlantıyı kaldırmak tokenı sağlayıcıda iptal etmez.

Vercel seçeneği T Bot'un Vercel API tokenı kullanan yerel MCP adaptörüdür; proje ve dağıtımları listeleme, proje bilgisi alma, proje oluşturma ve dağıtım oluşturma araçları sunar. Dağıtım varsayılan olarak önizlemedir; üretim hedefi açıkça seçilir. Adaptör resmi hosted OAuth MCP değildir. Supabase seçeneği resmi uzak MCP sunucusuna PAT ile bağlanır; hesap yetkileri dahilinde proje oluşturma ve Edge Function dağıtma araçları sunulabilir. GitHub seçeneği resmi uzak MCP sunucusuna PAT ile bağlanır; araçlar ve yazma erişimi seçili araçlar ve token izinlerine bağlıdır.

Her MCP araç çağrısı onay gerektirir; YOLO açıksa onaylar otomatik verilir. Salt okunur alt ajanlar MCP araçlarına erişmez. Gerçek servis bağlantıları veya dağıtımlar bu özellikler için test edilmedi.

Başlangıçtaki logo ve piksel bot animasyonunu kapatmak için `TBOT_NO_ANIMATION` ortam değişkenini tanımlayın. `NO_COLOR`, renkleri kaldırarak piksel görünümünü tek renkli yapar.
