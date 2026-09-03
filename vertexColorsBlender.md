# Ajouter des Vertex Colors dans Blender

Deux méthodes selon le cas : peinture manuelle (petits modèles) ou bake automatique depuis les textures existantes (modèles complexes type Sketchfab).

---

## Méthode 1 — Peindre les couleurs à la main

Utile pour un modèle simple ou peu de sommets.

1. **Passer en mode Vertex Paint**
   Sélectionnez l'objet, puis changez le mode d'interaction de _Object Mode_ à _Vertex Paint_ (menu déroulant en haut à gauche du viewport, ou `Ctrl+Tab`).

2. **Créer un attribut de couleur**
   Onglet _Object Data Properties_ (triangle vert) → section _Color Attributes_ → bouton `+`. Nommez-le (par défaut `Col` ou `Attribute`).

3. **Peindre**
   Choisissez une couleur dans le panneau de l'outil pinceau (`N` pour afficher le panneau si besoin), puis peignez en cliquant-glissant sur le maillage.

4. **Vérifier l'attribut actif**
   Dans _Object Data Properties → Color Attributes_, assurez-vous que l'attribut peint est bien sélectionné (surligné) — c'est lui qui sera exporté.

5. **Exporter en glTF**
   `File > Export > glTF 2.0 (.glb/.gltf)`. Dans les options d'export, section _Mesh_, cochez **Vertex Colors** (ou _Attributes_ selon la version de Blender).

6. **Vérifier dans Three.js**
   ```js
   console.log(baseGeometry.instance.attributes.color);
   ```
   Si l'attribut s'appelait `COLOR_0` dans le glTF, le `GLTFLoader` de Three.js le renomme normalement en `color`.

---

## Méthode 2 — Bake automatique des textures existantes (modèle complexe)

Recommandé pour un modèle Sketchfab avec des matériaux/textures déjà en place.

1. **Sélectionner tous les objets**
   `A` dans le viewport pour tout sélectionner. Si le modèle a plusieurs meshes, vous pouvez les fusionner temporairement (`Ctrl+J`) ou répéter l'opération sur chacun.

2. **Créer un attribut de couleur vide**
   Sur chaque mesh : _Object Data Properties_ → _Color Attributes_ → `+`. C'est la cible qui recevra les couleurs bakées.

3. **Passer le moteur de rendu sur Cycles**
   _Render Properties_ (icône caméra) → moteur = **Cycles**. Le bake vers vertex colors ne fonctionne pas correctement avec Eevee dans la plupart des versions.

4. **Configurer le Bake**
   Toujours dans _Render Properties_ → section _Bake_ :
   - `Bake Type` = **Diffuse**
   - Décochez `Direct` et `Indirect`, ne gardez que **Color** (pour éviter de baker l'éclairage/les ombres)

5. **Définir la cible sur les Vertex Colors**
   Dans la section _Bake_ → `Target` = **Active Color Attribute** (ou _Vertex Colors_ selon la version).

6. **Lancer le Bake**
   En mode Object, tous les meshes sélectionnés, cliquez sur **Bake** en bas du panneau. Une barre de progression apparaît ; le temps de calcul dépend de la complexité du modèle.

7. **Vérifier le résultat**
   Repassez en _Vertex Paint_ : les couleurs des textures doivent apparaître sur la géométrie sans texture appliquée.

8. **Exporter**
   Même étape que la méthode 1 : `File > Export > glTF 2.0`, cocher **Vertex Colors** dans la section _Mesh_.

---

## ⚠️ Limite à connaître

Les vertex colors sont **interpolées entre les sommets**, pas par pixel comme une texture. Si le modèle a peu de polygones mais des textures détaillées (logos, motifs fins), le bake perdra une bonne partie de ces détails.

**Solutions si le résultat est trop dégradé :**

- Subdiviser le mesh avant le bake (`Modifier > Subdivision Surface`, puis appliquer) — au prix d'un fichier plus lourd.
- Garder les textures d'origine et adapter le code Three.js pour lire les couleurs via les UV plutôt qu'un attribut `color` — meilleur rendu visuel, mais plus de travail sur le shader GPGPU.
