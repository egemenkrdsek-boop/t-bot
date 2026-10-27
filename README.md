![T Bot logosu](assets/tabit.webp)

# T Bot

T Bot, terminalden çalışan, farklı model sağlayıcılarıyla kullanılabilen yerel bir TypeScript ajanıdır. Etkileşimli oturumlarda veya tek bir istekle çalışır; modele bağlı olarak dosyalar, kabuk, Git, tarayıcı ve Windows masaüstü araçlarını kullanabilir.

## Gereksinimler ve kurulum

Node.js 20.3 veya üzeri, npm ve Git gerekir. Özel GitHub deposuna erişim yetkisi olan bir hesapla Git kimlik doğrulamasını yapılandırın. Son `main` sürümünü global yüklemek için:

```powershell
npm install --global git+https://github.com/egemenkrdsek-boop/t-bot.git
```

Kurulum, `prepare` aşamasında projeyi derler. Global kurulumdan sonra `tbot` komutu kullanılabilir; güncellemek için aynı komutu tekrar çalıştırın. Kaynak kodundan kurulum için [kurulum rehberine](docs/install.md) bakın.

## Sağlayıcı ayarları

Etkileşimli terminalde `tbot config` çalıştırın; sağlayıcı kimliği, model, isteğe bağlı API adresi ve anahtar saklama seçeneklerini girin. Kullanılabilir kimlikler `tbot providers` ile listelenir: OpenAI, OpenRouter, Groq, Together, DeepSeek, xAI, Mistral, Fireworks, Cerebras, Anthropic, Gemini, Ollama, LM Studio ve özel OpenAI uyumlu uç nokta. Varsayılan OpenAI ve `gpt-4o-mini` modelidir; seçilen sağlayıcıda erişiminiz olan bir model belirtin.

Anahtar, sağlayıcıya özgü ortam değişkeniyle (örneğin `OPENAI_API_KEY`) veya genel `TBOT_API_KEY` ile de sağlanabilir; sağlayıcıya özgü değişken önceliklidir. Windows'ta kaydedilen anahtarlar mümkün olduğunda kullanıcıya bağlı DPAPI ile şifrelenir. Şifreleme kullanılamazsa ve diğer platformlarda anahtar erişimi kısıtlanmış bir dosyada şifrelenmeden saklanır; uygulama bu durumu bildirir.

Ollama ve LM Studio seçenekleri yerel çalışan bir sunucu ve yüklenmiş model gerektirir. Çevrimdışı model kullanımı için bunları yerel uç noktaya yönlendirin; T Bot tek başına bir model içermez. Özel uç noktalar HTTPS veya localhost üzerinde HTTP kullanmalıdır.

## Kullanım

```text
tbot                              Etkileşimli oturum
tbot "isteğiniz"                  Tek seferlik istek
tbot -p <sağlayıcı> -m <model>    Bu oturum için seçim
tbot -w <dizin>                   Çalışma dizini seçimi
tbot sessions                     Kayıtlı oturumları listele
tbot --resume <id>                Oturuma devam et
tbot config                       Sağlayıcı ayarları
tbot providers                    Sağlayıcıları listele
tbot doctor                       Ortam ve ayar durumunu göster
tbot --help                       Yardım
tbot --version                    Sürüm
```

Etkileşimli modda `/help`, `/clear`, `/provider`, `/model`, `/sessions`, `/config`, `/resume` ve `/exit` veya `/quit` kullanılabilir. Ayar değiştirme ve oturuma devam etme komutları ilgili terminal komutuna yönlendirir. Çok satırlı giriş için satırı `\` ile bitirin. Ctrl+C geçerli işlemi iptal eder.

## Araçlar ve gizlilik

Ajan dosya okuma ve değiştirme, kabuk komutu, Git işlemleri, izole tarayıcı ve Windows masaüstü kontrolü araçlarını sunar. Değişiklik yapabilen işlemler için varsayılan olarak onay istenir. Kabuk komutları kullanıcının yetkileriyle çalışır ve çalışma dizini dışına erişebilir. Terminal olmadan onay gerektiren işlemler reddedilir.

Tarayıcı araçları paketle gelen `playwright-core` ve uyumlu kurulu Chrome veya Chromium gerektirir; mevcut kişisel tarayıcı profilini kullanmaz. Masaüstü kontrolü yalnızca etkileşimli Windows masaüstünde çalışır ve PowerShell gerektirir. Ekran görüntüleri yerel dosyalara kaydedilebilir.

Ayarlar, anahtarlar ve oturumlar Windows'ta `%APPDATA%\TBot`, diğer ortamlarda `~/.config/TBot` altında tutulur. Bulut sağlayıcısı seçildiğinde konuşma ve modele sunulan araç sonuçları ilgili sağlayıcıya gönderilir; dosya içerikleri veya komut çıktıları da bu sonuçlara dahil olabilir. Yerel bir sağlayıcı seçmek, model isteklerinin seçilen yerel sunucuya gitmesini sağlar; tarayıcı ve kabuk gibi araçlar ayrıca ağ erişimi yapabilir.

## Lisans

Proje [MIT lisanslıdır](LICENSE). Köken, üçüncü taraf bildirimleri ve dağıtım konuları için [hukuki notlara](docs/legal.md) ve [üçüncü taraf bildirimlerine](THIRD_PARTY_NOTICES.md) bakın.
