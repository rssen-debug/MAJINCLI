/*
  LENT — egna RE-regler.
  Filen läses in av re.analyze / re.yara / re.iocs (tillsammans med de inbyggda reglerna).
  Lägg till en regel via agenten:  lent({"tool":"re.rules","args":{...}})  eller klipp in här.
  Syntax är en miniature av YARA som LENT tolkar själv (se src/core/binary/yara.js):
    - rule-namn, meta (string-fält), strings ($a = "text" / { 4D 5A 90 00 }), condition med
      any / all / N of / and / or / filesize / entrypoint / §offset.
*/

rule LENT_Suspicious_Packer_Stubs
{
  meta:
    author = "LENT"
    purpose = "känd packare/crypter-signatur"
    severity = "medium"
  strings:
    $upx1 = "UPX0"
    $upx2 = "UPX1"
    $themida = "Themida" wide ascii
    $vmprot = "VMProtect" wide ascii
    $aspack = "aPLib"
  condition:
    any of them
}

rule LENT_Malware_Imports
{
  meta:
    author = "LENT"
    purpose = "importer som är ovanliga i vanliga program"
    severity = "high"
  strings:
    $v1 = "VirtualAlloc"
    $v2 = "WriteProcessMemory"
    $v3 = "CreateRemoteThread"
    $v4 = "SetWindowsHookEx"
    $k1 = "GetAsyncKeyState"
    $k2 = "keybd_event"
    $c1 = "CryptEncrypt"
    $r1 = "URLDownloadToFile"
    $s1 = "ShellExecute"
    $reg = "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
  condition:
    uint16be(0) == 0x4D5A and 2 of them
}

rule LENT_Loader_Dropper_Behaviour
{
  meta:
    author = "LENT"
    purpose = "typiskt loader-/dropper-beteende"
    severity = "high"
  strings:
    $tmp = "\\AppData\\Local\\Temp\\" wide ascii
    $ex = ".exe" nocase
    $sv = "schtasks"
    $persistence = "CurrentVersion\\Run"
    $dump = "lsass.dmp"
    $mimikatz = "mimikatz"
    $cobalt = "beacon"
  condition:
    2 of them
}

rule LENT_Embedded_PE_Overlay
{
  meta:
    author = "LENT"
    purpose = "PE i overlay:en — ofta inbäddad payload"
    severity = "high"
  strings:
    $mz = { 4D 5A 90 00 03 00 00 00 }
  condition:
    $mz and filesize > 200000
}

rule LENT_Ransomware_Notes
{
  meta:
    author = "LENT"
    purpose = "lossennote-liknande text"
    severity = "critical"
  strings:
    $n1 = "HOW TO DECRYPT"
    $n2 = "your files have been encrypted" nocase
    $n3 = "bitcoin" nocase
    $n4 = "readme_for_decrypt" nocase
    $ext = ".locked"
  condition:
    2 of them
}

rule LENT_Installer_Signature
{
  meta:
    author = "LENT"
    purpose = "oskyldig: vanliga installers (Inno/NSIS/MSI)"
    severity = "info"
  strings:
    $inno = "Inno Setup"
    $nsis = "Nullsoft"
    $msi = { D0 CF 11 E0 A1 B1 1A E1 }
    $electron = "electron.asar"
  condition:
    any of them
}

rule LENT_Android_Suspicious
{
  meta:
    author = "LENT"
    purpose = "apk med riskfyllda tillstånd/api"
    severity = "medium"
  strings:
    $a1 = "android.permission.SEND_SMS"
    $a2 = "android.permission.READ_CONTACTS"
    $a3 = "android.permission.ACCESS_FINE_LOCATION"
    $a4 = "getRuntime().exec"
    $a5 = "SmsManager"
    $a6 = "startActivityForResult"
  condition:
    2 of them
}

rule LENT_Crypto_Miner
{
  meta:
    author = "LENT"
    purpose = "miner-strängar/pooler"
    severity = "high"
  strings:
    $x1 = "stratum+tcp://"
    $x2 = "xmrig" nocase
    $x3 = "--donate-level"
    $x4 = "miner" nocase
    $x5 = "monero" nocase
  condition:
    2 of them
}
