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

İlk açılışta seçili sağlayıcının anahtarı yoksa etkileşimli kurulum sağlayıcı, model ve gizli anahtar girişini açar. Terminal dışındaki kullanımda eksik anahtar için ilgili ortam değişkeni veya `tbot config` yönergesi gösterilir.

Etkileşimli terminalde `tbot config` çalıştırın; sağlayıcı ve modeli ok tuşları ve Enter ile menüden seçin, gerektiğinde yalnızca API anahtarını yazın. Model listesi sağlayıcıdan alınır; erişilemezse yerleşik seçenekler gösterilir. Öncelikli sağlayıcılar Google Gemini (`gemini`), OpenAI (`openai`), Anthropic (`anthropic`) ve OpenRouter (`openrouter`) olarak listelenir. Diğer seçenekler dahil tüm sağlayıcıları `tbot providers` gösterir. Varsayılan OpenAI ve `gpt-4o-mini` modelidir. Erişim ve özellik desteği seçtiğiniz sağlayıcıya ve modele bağlıdır.

Kaydedilen API anahtarları sağlayıcı kimliğine göre ayrı tutulur. `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ve `OPENROUTER_API_KEY` ortam değişkenleri de kullanılabilir; kayıtlı anahtar bulunmadığında kullanılır. Genel `TBOT_API_KEY`, kayıtlı ve sağlayıcıya özgü anahtarlar yoksa ortak yedektir. Windows'ta kaydedilen anahtarlar mümkün olduğunda kullanıcıya bağlı DPAPI ile şifrelenir. Şifreleme kullanılamazsa ve diğer platformlarda anahtar erişimi kısıtlanmış bir dosyada şifrelenmeden saklanır; uygulama bu durumu bildirir.

Ollama ve LM Studio seçenekleri yerel çalışan bir sunucu ve yüklenmiş model gerektirir. Çevrimdışı model kullanımı için bunları yerel uç noktaya yönlendirin; T Bot tek başına bir model içermez. Özel uç noktalar HTTPS veya localhost üzerinde HTTP kullanmalıdır.

401 kimlik doğrulama hatasında OpenRouter hesabınızda yeni bir API anahtarı oluşturup T Bot içinde `/auth` ile girin. Önceki istek otomatik tekrar edilmez. OpenRouter için yeni anahtar kaydedilmeden önce sağlayıcının anahtar uç noktasında doğrulanır; doğrulama başarısızsa önceki anahtar korunur.

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
tbot --yolo                      Bu oturumda araç onaylarını otomatik ver
tbot --help                       Yardım
tbot --version                    Sürüm
```

Etkileşimli modda `/help`, `/clear`, `/provider`, `/model`, `/sessions`, `/config`, `/resume` ve `/exit` veya `/quit` kullanılabilir. `/provider`, `/model` ve `/config` seçim menüsünü açar; `/resume` terminal komutuna yönlendirir. Çok satırlı giriş için satırı `\` ile bitirin. Ctrl+C geçerli işlemi iptal eder.

- `/goal <hedef>` hedefi kaydedip sınırlı bir çalışma başlatır. `/goal status`, `/goal run`, `/goal pause`, `/goal resume`, `/goal complete` ve `/goal cancel` ile durumunu yönetin. Tamamlanma açıkça işaretlenir; çalışma otomatik olarak sonsuza kadar sürmez.
- `/plan <istek>` araç kullanmadan bir plan oluşturur. Geçerli oturumda bu planı inceleyip `/plan apply` ile uygulamayı başlatabilirsiniz; araç onayları ayrıca geçerlidir.
- `/subagents` alt ajan modelini seçer veya açıkken değiştirme ve kapatma menüsünü gösterir. `/subagents <istek>` seçilen modelle paralel salt okunur araştırma başlatır; uygulamayı ana ajan yapar. Açıkken sonraki normal isteklerde de alt ajanlar kullanılabilir.

Etkileşimli oturumda `/yolo` menüsünden veya `/yolo on` ve `/yolo off` komutlarıyla araç onaylarının otomatik verilmesini seçebilirsiniz. `--yolo` modu başlangıçta açar. Ayar yalnızca geçerli oturumda geçerlidir; varsayılan olarak onay istenir. YOLO açıkken kabuk komutları ve diğer onay gerektiren araçlar kullanıcı yetkileriyle otomatik çalışabilir. Plan uygulaması yine `/plan apply` ile başlatılır; salt okunur alt ajan sınırları korunur.

## Araçlar ve gizlilik

Ajan dosya okuma ve değiştirme, kabuk komutu, Git işlemleri, izole tarayıcı ve Windows masaüstü kontrolü araçlarını sunar. Değişiklik yapabilen işlemler için varsayılan olarak onay istenir. Kabuk komutları kullanıcının yetkileriyle çalışır ve çalışma dizini dışına erişebilir. Terminal olmadan onay gerektiren işlemler reddedilir.

Tarayıcı araçları paketle gelen `playwright-core` ve uyumlu kurulu Chrome veya Chromium gerektirir; mevcut kişisel tarayıcı profilini kullanmaz. Masaüstü kontrolü yalnızca etkileşimli Windows masaüstünde çalışır ve PowerShell gerektirir. Ekran görüntüleri yerel dosyalara kaydedilebilir.

Ayarlar, anahtarlar ve oturumlar Windows'ta `%APPDATA%\TBot`, diğer ortamlarda `~/.config/TBot` altında tutulur. Bulut sağlayıcısı seçildiğinde konuşma ve modele sunulan araç sonuçları ilgili sağlayıcıya gönderilir; dosya içerikleri veya komut çıktıları da bu sonuçlara dahil olabilir. Yerel bir sağlayıcı seçmek, model isteklerinin seçilen yerel sunucuya gitmesini sağlar; tarayıcı ve kabuk gibi araçlar ayrıca ağ erişimi yapabilir.

## Lisans

Proje [MIT lisanslıdır](LICENSE). Köken, üçüncü taraf bildirimleri ve dağıtım konuları için [hukuki notlara](docs/legal.md) ve [üçüncü taraf bildirimlerine](THIRD_PARTY_NOTICES.md) bakın.
