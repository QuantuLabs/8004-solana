# /battle-test - ATOM Adversarial Security Audit

**MINDSET: Tu es un attaquant malveillant avec des ressources illimitées. Ton but est de DÉTRUIRE ce système de réputation, voler de l'argent aux utilisateurs, ou manipuler les scores pour ton profit.**

---

## Phase 0: CHANGELOG OBLIGATOIRE

**AVANT TOUTE ANALYSE, LIRE LE CHANGELOG:**

```
Read: ATOM-CHANGELOG.md
```

Ce fichier contient:
- Historique complet des versions (v1 → actuel)
- Vulnérabilités découvertes ET fixées
- Vulnérabilités OUVERTES (🔴)
- Fixes cassés ou incomplets (⚠️)
- Trend de confiance Hivemind

**RÈGLE CRITIQUE:**
- Ne JAMAIS "redécouvrir" une vulnérabilité déjà listée comme ✅ fixée sans vérifier le code du fix
- TOUJOURS vérifier si un fix listé comme ⚠️ est réellement cassé
- Les vulnérabilités 🔴 OPEN sont la priorité

**À LA FIN DE L'AUDIT:**
Mettre à jour `ATOM-CHANGELOG.md` avec:
1. Nouvelles vulnérabilités découvertes (avec ID séquentiel V##)
2. Status des vulnérabilités existantes (fixée? cassée?)
3. Nouveau score de confiance Hivemind

---

## Phase 1: Reconnaissance - LIRE TOUT LE CODE

### 1.1 Lire le code source COMPLET
```
Read: programs/atom-engine/src/compute.rs
Read: programs/atom-engine/src/state.rs
Read: programs/atom-engine/src/params.rs
Read: programs/atom-engine/src/lib.rs
```

**IMPORTANT:** Utiliser l'outil Read pour CHAQUE fichier. Ne PAS résumer. Le contenu EXACT sera nécessaire pour Hivemind.

Chercher:
- **Divisions entières** qui peuvent donner 0
- **Overflows/underflows** dans les calculs
- **Conditions de course** entre transactions
- **Valeurs par défaut** exploitables
- **Chemins de code** qui skip les validations
- **Interactions entre protections** qui s'annulent

### 1.2 Mapper les surfaces d'attaque

Pour CHAQUE instruction publique, demander:
- Qui peut l'appeler?
- Quels paramètres sont contrôlables?
- Quelles validations peuvent être bypassées?
- Quel état peut être corrompu?

---

## Phase 2: Brainstorm Offensif avec Hivemind

### ⚠️ RÈGLE ABSOLUE: CODE COMPLET OBLIGATOIRE ⚠️

**NE JAMAIS RÉSUMER LE CODE.** Hivemind doit recevoir le code EXACT tel que lu par l'outil Read.

**POURQUOI:** Un résumé peut introduire des erreurs. Exemple: GPT-5.2 a trouvé un "bug critique" V29 qui n'existait pas dans le vrai code - le résumé avait une erreur.

### 2.1 Préparer le contexte Hivemind

Le contexte DOIT contenir dans cet ordre:
1. **ATOM-CHANGELOG.md** - Contenu COMPLET (copier-coller exact)
2. **compute.rs** - Contenu COMPLET (copier-coller exact de la sortie Read)
3. **state.rs** - Contenu COMPLET (copier-coller exact)
4. **params.rs** - Contenu COMPLET (copier-coller exact)

### 2.2 Format du contexte Hivemind

```
=== ATOM-CHANGELOG.md ===
[COLLER ICI LE CONTENU EXACT DU FICHIER]

=== compute.rs ===
[COLLER ICI LE CONTENU EXACT - TOUT LE FICHIER]

=== state.rs ===
[COLLER ICI LE CONTENU EXACT - TOUT LE FICHIER]

=== params.rs ===
[COLLER ICI LE CONTENU EXACT - TOUT LE FICHIER]
```

### 2.3 Question pour Hivemind

```
Tu es un auditeur de sécurité black-hat. Analyse ATOM v[VERSION] et trouve TOUTES les vulnérabilités restantes.

Le code COMPLET est fourni ci-dessus. Analyse-le ligne par ligne.

QUESTION: Quelles vulnérabilités RESTENT? Cherche:
- Vulnérabilités listées 🔴 OPEN non encore fixées
- Fixes listés ⚠️ qui sont cassés
- NOUVELLES vulnérabilités non encore découvertes
- Interactions entre protections qui créent des failles
- Dead code / branches mortes
- Integer overflow/underflow
- Division par zéro possibles

Pour chaque vulnérabilité:
1. ID (V## séquentiel après le dernier du changelog)
2. Nom créatif
3. Sévérité (CRITICAL/HIGH/MEDIUM/LOW)
4. Ligne(s) de code exacte(s) concernée(s)
5. Mécanisme d'exploitation détaillé
6. Coût (SOL)
7. Impact
8. ROI (gain/coût)
9. Fix proposé
```

### 2.4 Si Hivemind échoue

1. **Timeout (AbortError):** Le timeout est maintenant de 10 minutes. Si ça échoue encore, le contexte est peut-être trop gros - découper en 2 requêtes (compute.rs seul, puis state.rs seul)
2. **Erreur réseau:** Réessayer 3 fois
3. **NE JAMAIS compacter/résumer** le code pour "faire rentrer" - mieux vaut 2 requêtes avec code complet

---

## Phase 3: Vérifier les Vulnérabilités Ouvertes

D'après le CHANGELOG, les vulnérabilités 🔴 OPEN actuelles sont:

| ID | Nom | Sévérité | À Vérifier |
|----|-----|----------|------------|
| (Lire ATOM-CHANGELOG.md pour la liste actuelle) |

Pour CHAQUE vulnérabilité ouverte:
1. Reproduire l'exploitation
2. Calculer le ROI
3. Proposer un fix minimal

---

## Phase 4: Attaques à Tester

### 4.1 Attaques Économiques
- [ ] **Platinum Fraud**: Atteindre Platinum avec Sybils, scammer, maintenir score
- [ ] **Competitor Nuke**: Coût minimal pour détruire réputation d'un concurrent
- [ ] **Reputation Laundering**: Créer/détruire agents pour blanchir réputation
- [ ] **Fee Extraction**: Forcer des revokes coûteux sur des victimes

### 4.2 Attaques Techniques
- [ ] **Ring Buffer Overflow**: Que se passe-t-il avec u64::MAX feedbacks?
- [ ] **HLL Saturation**: Tous les registres à 15, que se passe-t-il?
- [ ] **Slot Manipulation**: Exploiter les calculs basés sur current_slot
- [ ] **Concurrent Feedback**: Race condition entre deux feedbacks simultanés?
- [ ] **Config Frontrun**: Frontrunner un changement de config authority?

### 4.3 Attaques Combinées
- [ ] **False Idol**: HLL stuff + Iron Dome + Platinum = scam parfait
- [ ] **Scorched Earth**: Créer chaos pour rendre le système inutilisable
- [ ] **Cartel Attack**: Groupe coordonné qui contrôle les réputations

---

## Phase 5: Exécuter les Tests

```bash
# Build et test complet
anchor build && anchor test --skip-build

# Tests spécifiques
anchor run iron      # Iron Dome
anchor run entropy   # Entropy Gate
anchor run hll       # HLL Stuffing
anchor run grief     # Griefing
anchor run security  # Audit complet
```

Pour CHAQUE test qui passe, demander: "Est-ce que le test est assez agressif? Ai-je testé le pire cas?"

---

## Phase 6: Analyse de Rentabilité

Pour chaque attaque viable, calculer:

| Métrique | Valeur |
|----------|--------|
| Coût total (SOL) | ? |
| Temps requis | ? |
| Probabilité succès | ? |
| Gain potentiel | ? |
| Risque détection | ? |
| **ROI** | Gain / Coût |

**RÈGLE**: Si ROI > 1, l'attaque est viable et DOIT être fixée.

---

## Phase 7: Rapport et MISE À JOUR CHANGELOG

### 7.1 Générer le rapport

```
=== ATOM PENETRATION TEST REPORT ===

Date: [TIMESTAMP]
Version Auditée: v[X]
Changelog Reference: ATOM-CHANGELOG.md

VULNÉRABILITÉS OUVERTES VÉRIFIÉES:
[Status de chaque vuln 🔴 du changelog]

NOUVELLES VULNÉRABILITÉS DÉCOUVERTES:
[Liste avec ID V## séquentiel]

FIXES CASSÉS CONFIRMÉS:
[Liste des ⚠️ confirmés cassés]

FIXES VALIDÉS:
[Liste des fixes qui fonctionnent]

ATTACK SCENARIOS:
1. [Scénario complet]
   - Coût: X SOL
   - Impact: Y
   - ROI: Z

HIVEMIND CONFIDENCE: [X%]
OVERALL SECURITY: BROKEN / WEAK / MODERATE / STRONG
```

### 7.2 METTRE À JOUR LE CHANGELOG

**OBLIGATOIRE après chaque audit:**

```
Edit: ATOM-CHANGELOG.md
```

Ajouter:
1. Nouvelles vulnérabilités avec ID V## séquentiel
2. Mettre à jour le status des vulnérabilités existantes
3. Mettre à jour le trend de confiance
4. Ajouter la date de l'audit

---

## Phase 8: Fix et Re-Test

Si vulnérabilités trouvées:

1. **Proposer fix MINIMAL** - Pas de sur-ingénierie
2. **Vérifier interactions** - Le fix casse-t-il autre chose?
3. **Implémenter**
4. **Mettre à jour CHANGELOG** - Marquer comme F## (fix)
5. **Créer test de régression** - Le test doit PROUVER que l'attaque échoue
6. **Re-attaquer** - Retour Phase 2 avec Hivemind

---

## Commandes Utiles

```bash
# Voir les logs détaillés
anchor test --skip-build 2>&1 | tee test-output.log

# Test spécifique avec verbose
RUST_LOG=debug anchor test --skip-build

# Vérifier l'état d'un compte
solana account <PUBKEY> --output json
```

---

## Mindset Check

Avant de terminer, se demander:

- [ ] Ai-je lu le CHANGELOG avant de commencer?
- [ ] Ai-je vérifié toutes les vulnérabilités 🔴 OPEN?
- [ ] Ai-je confirmé/infirmé les fixes ⚠️ cassés?
- [ ] Ai-je envoyé le code COMPLET (pas résumé) à Hivemind?
- [ ] Ai-je pensé comme un attaquant motivé par l'argent?
- [ ] Ai-je testé les pires scénarios?
- [ ] Ai-je combiné plusieurs attaques?
- [ ] Ai-je vérifié les edge cases (0, MAX, overflow)?
- [ ] Le système résiste-t-il à un adversaire avec 1000 SOL de budget?
- [ ] Ai-je MIS À JOUR le CHANGELOG?

**SI LA RÉPONSE À UNE QUESTION EST "NON" OU "JE NE SAIS PAS", CONTINUER LES TESTS.**
