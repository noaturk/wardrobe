<div align="center">

# Noa's Wardrobe

Fotografiraj svoju odjeću. Dobiješ uredan katalog svakog komada i kombinacije složene iz njega.

[![Licenca: MIT](https://img.shields.io/badge/licenca-MIT-191919?style=flat-square)](LICENSE)
[![Node 22](https://img.shields.io/badge/node-22-191919?style=flat-square)](package.json)
[![React 19](https://img.shields.io/badge/react-19-191919?style=flat-square)](package.json)

Fork projekta [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe), preraden u privatnu produkcijsku aplikaciju.

</div>

Wardrobe pretvara fotografije odjeće s mobitela u pregledan ormar. Svaka fotografija
se pregleda i na njoj se pronađu pojedinačni komadi, svaki komad se izreže u čistu
katalošku sliku, a odobreni komadi postaju biblioteka koju aplikacija koristi za
predlaganje kombinacija.

Ovo je aplikacija **za jednog vlasnika**: jedan konfigurirani račun, bez registracije,
bez gostujućeg pristupa i bez javnog demoa. Fotografije odjeće su osobne, pa su
sve stranice, API rute i slike iza prijave — ništa se ne poslužuje s javne adrese.
Sučelje je na hrvatskom, a kod i dokumentacija na engleskom.

## Tri ekrana

**Ormar.** Sve što imaš, razvrstano po kategorijama: gornji dijelovi, jakne,
donji dijelovi, odijela i kompleti, dodaci i obuća. Pretraga ide po nazivima i
markama, svaki komad se otvara s detaljima, a aplikacija se može dodati na
početni zaslon mobitela i raditi preko cijelog ekrana.

**Kombinacije.** Cjelovite kombinacije složene od komada koje stvarno imaš, na
dva načina. *Prema vremenu:* aktualna prognoza s Open-Meteo servisa za tvoju
lokaciju ili spremljeni ručni uvjeti kad lokaciju ne želiš dijeliti —
temperatura, kiša i vjetar mijenjaju izbor. *Prema prigodi:* opišeš svojim
riječima kamo ideš, a aplikacija to poveže s tvojom bibliotekom. Oboje radi
isključivo nad tvojim podacima, bez ijednog AI poziva i bez troška.

**Na meni.** Dva načina da vidiš komad na sebi umjesto položenog: AI proba
generirana iz privatne referentne fotografije koju jednom postaviš u Postavkama,
ili prava fotografija koju sam snimiš kamerom ili odabereš iz galerije. Prave
fotografije nikad ne odlaze OpenAI-ju, a svaka AI slika nastaje tek nakon što je
izričito potvrdiš.

## Kako izgleda uvoz odjeće

1. Povuci, zalijepi ili odaberi do 20 fotografija odjednom — uključujući iPhone HEIC/HEIF, koji se pretvara u pregledniku prije slanja.
2. Na svakoj se fotografiji prepoznaju pojedinačni komadi odjeće preko OpenAI Responses API-ja.
3. Svaki prepoznati komad se izreže u čistu katalošku sliku preko OpenAI Images API-ja.
4. Vidljiv red čekanja prikazuje pretvaranje, prepoznavanje i izrezivanje za svaku fotografiju te upozorava kad fotografija izgleda kao neka koju si već uvezao.
5. Svaki izrezani komad pregledaš i odobriš, urediš ili ponovno generiraš. Ništa ne ulazi u ormar bez tvoje potvrde.

## Zašto ostaje jeftino i privatno

- Prijedlozi kombinacija, izbor prema vremenu, podudaranje prigode i prepoznavanje duplikata rade lokalno — **bez AI poziva i bez troška**
- AI se koristi samo pri uvozu i kod izričito potvrđene AI probe; dnevno ograničenje generiranja je opcionalno
- OpenAI ključ postoji samo u okruženju poslužitelja i nikad ne dolazi do preglednika
- Uploadi se provjeravaju po potpisu datoteke, čiste od metapodataka, ponovno kodiraju i spremaju na putanje koje bira poslužitelj, izvan objavljenog builda
- Sesije su na poslužitelju, sa strogim zastavicama kolačića, CSRF tokenima i provjerom istog izvora; lozinka je scrypt hash, uz opcionalnu TOTP dvofaktorsku prijavu
- Bez analitike, praćenja i vanjskog prijavljivanja grešaka
- Automatski dnevni backup podataka i slika, uz skriptu za vraćanje

## Tehnologije

React 19 i Vite 6 na frontendu. Express 5 na Node 22 poslužuje izgrađenu
aplikaciju, privatni API i slike. MySQL drži metapodatke, brojače potrošnje i
sesije u produkciji, dok je lokalni JSON razvojna zamjena. Sharp obavlja svu
obradu slika, a OpenAI Responses i Images API prepoznavanje i izrezivanje.
Pohrana je zamjenjiva: privatni lokalni direktorij ili bilo koji S3-kompatibilan
bucket, nikad javni objekti.

U produkciji radi na Hostingeru iza proxyja, na privatnoj poddomeni.

## Pokretanje lokalno

```bash
git clone https://github.com/noaturk/wardrobe.git
cd wardrobe
npm install
cp .env.example .env
npm run auth:hash-password   # u ADMIN_PASSWORD_HASH zalijepi samo dobiveni hash
npm run dev
```

Otvori [localhost:3000](http://localhost:3000). Aplikacija radi i bez OpenAI ključa —
uvoz je onemogućen dok se ne postavi `OPENAI_API_KEY`, a opcionalna AI proba uz to
traži i referentnu fotografiju u Postavkama.

Produkcija koristi Express ulaznu točku (`npm run start`), nikad `vite preview`.

| Varijabla | Zadano |
| --- | --- |
| `OPENAI_API_KEY` | obavezno za uvoz |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `DAILY_IMAGE_GENERATION_LIMIT` | `0` (bez ograničenja) |
| `STORAGE_DRIVER` | `local` |

Sve su varijable dokumentirane u [`.env.example`](.env.example).

## Dokumentacija

[Kreni odavde](docs/index.md) — arhitektura, tok podataka, sigurnost, privatnost,
baza, pohrana, postavljanje OpenAI-ja, deploy na Hostinger, backup i vraćanje,
održavanje i testiranje. Dokumentacija je na engleskom.

```bash
npm test        # unit testovi
npm run check   # sintaksa, build i provjera tajni u klijentskom kodu
```

## Zasluge

Ovaj je projekt nastao iz izvornog open source projekta
[tandpfun/wardrobe](https://github.com/tandpfun/wardrobe) (upstream commit `f44006c`),
predstavljenog [ovom objavom](https://x.com/cdngdev/status/2076812846793650485).
Izvorni rad je pod MIT licencom, copyright © 2026 Open Wardrobe contributors.

Ovaj fork je preraden u privatnu produkcijsku aplikaciju za jednog vlasnika:
prijava i zaštita svih ruta, MySQL i privatna pohrana, hrvatsko sučelje,
kombinacije prema vremenu i prigodi, "Na meni", backup i deploy na Hostinger.

Licenca: [MIT](LICENSE). Potpuna atribucija izvornog projekta i ostalih
ovisnosti je u [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Pretvaranje HEIC/HEIF slika u pregledniku koristi
[heic-to](https://github.com/hoppergee/heic-to) pod LGPL-3.0 licencom.
