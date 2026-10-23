Följ den här ordningen. Stanna och rapportera om ett steg inte kan göras.

1. **Hitta CV:t.** Använd `fs_search` i de mappar ägaren gett åtkomst till.
   Leta efter filnamn som innehåller cv, resume, merit eller liknande, med
   filtillägg .pdf, .docx, .md eller .txt. Om flera hittas: välj den senast
   ändrade och säg vilken du valde och varför.
2. **Läs det.** Använd `document_read` — den läser texten i PDF, DOCX och XLSX.
   `fs_read` visar bara rå bytes för de formaten och är fel verktyg här.
   Sammanfatta kort: roller, år, kompetenser, språk. Hitta inte på något som
   inte står i texten. Om `document_read` svarar `confidence: "partial"` ska du
   säga att en del tecken kan vara felavlästa. Om den svarar `NO_TEXT_LAYER` är
   filen en skanning — säg det och be om en textbaserad version.
3. **Sök jobb.** `web_search` eller `jobs_search` med termer som kommer från
   CV:t (roll, ort, senioritet). Ägaren anger ofta ort och antal.
4. **Verifiera.** Öppna annonsen med `browser_open` och kontrollera att den
   finns och att kraven matchar. En sökträff är inte ett verifierat jobb.
5. **Jämför.** Ställ upp de bästa kandidaterna med ort, roll och varför de passar.
   Säg tydligt när en annons saknar information i stället för att gissa.
6. **Förbered, skicka inte.** `jobs_prepare` för ansökan eller personligt brev.
   Sammanställ allt och be om godkännande innan något skickas in.

Regler:
- Säg aldrig att en ansökan är skickad om du inte har en bekräftelse från sajten.
- Fyll aldrig i eller skicka ett formulär utan att ägaren först ser innehållet.
- Kringgå aldrig inloggning, CAPTCHA eller sajtens villkor.
- Om ett verktyg saknas: säg vilket och vilken behörighet som fattas.
