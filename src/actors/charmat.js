// Character materials: every character surface gets a shared rim light and a per-material
// hit-flash uniform. Skin adds a cheap subsurface terminator tint, hair a Kajiya-Kay
// strand highlight (two shifted lobes along the strand direction taken from the UV frame).
import * as THREE from 'three';

// Shared rim-light uniforms so characters read against dark backgrounds. Set per level.
export const rimUniforms = {
  uRimColor: { value: new THREE.Color('#7fb6ff') },
  uRimStrength: { value: 0.22 },
  uRimPower: { value: 3.4 },
};

const SKIN_DIFFUSE = `
	#ifdef CHAR_SKIN
	{
		float ndlRaw = dot( geometryNormal, directLight.direction );
		// light bleeding through the terminator, red-shifted like skin
		float band = smoothstep( -0.3, 0.05, ndlRaw ) * ( 1.0 - smoothstep( 0.0, 0.45, ndlRaw ) );
		vec3 sss = vec3( 0.55, 0.16, 0.08 ) * band * 0.55;
		reflectedLight.directDiffuse += ( irradiance + sss * directLight.color ) * BRDF_Lambert( material.diffuseColor );
	}
	#else
		reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	#endif`;

const HAIR_SPEC = `
	#ifdef CHAR_HAIR
	{
		vec3 H = normalize( directLight.direction + geometryViewDir );
		vec3 T1 = normalize( gHairT + geometryNormal * 0.12 );
		vec3 T2 = normalize( gHairT - geometryNormal * 0.22 );
		float d1 = dot( T1, H ), d2 = dot( T2, H );
		float s1 = pow( max( 0.0, sqrt( max( 0.0, 1.0 - d1 * d1 ) ) ), 90.0 );
		float s2 = pow( max( 0.0, sqrt( max( 0.0, 1.0 - d2 * d2 ) ) ), 34.0 );
		float wrapL = smoothstep( -0.15, 0.35, dot( geometryNormal, directLight.direction ) );
		vec3 tint = normalize( material.diffuseColor + 0.02 ) * 1.2;
		reflectedLight.directSpecular += directLight.color * wrapL * ( vec3( 0.03 ) * s1 + tint * 0.032 * s2 ) * gHairSpec;
	}
	#else
		reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#endif`;

let litChunk = null;
function lightsChunk() {
  if (!litChunk) {
    const src = THREE.ShaderChunk.lights_physical_pars_fragment;
    litChunk = 'vec3 gHairT = vec3( 0.0, 1.0, 0.0 );\nfloat gHairSpec = 1.0;\n' + src
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}', SKIN_DIFFUSE + '\n}')
      .replace('reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );', HAIR_SPEC);
  }
  return litChunk;
}

/**
 * Injects rim light + hit flash (and optional skin / hair shading) into a standard material.
 * kind: '' | 'skin' | 'hair'
 */
export function addRim(material, kind = '') {
  material.userData.hit = material.userData.hit || { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = rimUniforms.uRimColor;
    shader.uniforms.uRimStrength = rimUniforms.uRimStrength;
    shader.uniforms.uRimPower = rimUniforms.uRimPower;
    shader.uniforms.uHitFlash = material.userData.hit;
    let fs = shader.fragmentShader;
    if (kind) {
      fs = (kind === 'skin' ? '#define CHAR_SKIN\n' : '#define CHAR_HAIR\n') + fs;
      fs = fs.replace('#include <lights_physical_pars_fragment>', lightsChunk());
      if (kind === 'hair') {
        // hair cards are double sided but shade with their authored (outward) normals on both faces
        fs = fs.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin
          .replace('normal *= faceDirection;', '')
          .replace('tbn[0] *= faceDirection;', '').replace('tbn[1] *= faceDirection;', ''));
        // strand direction = UV v-axis of the tangent frame built for the normal map
        fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n\tgHairT = normalize( tbn[ 1 ] );');
        // highlights break up along individual strands (strand texture luminance)
        fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n\t#ifdef USE_MAP\n\tgHairSpec = sampledDiffuseColor.r * sampledDiffuseColor.r * 1.8;\n\t#endif');
        // hair is a porous volume: damp environment sheen at grazing angles (keeps dark hair dark)
        fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.indirectSpecular *= 0.12;');
      }
    }
    fs = fs
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength; uniform float uRimPower; uniform float uHitFlash;')
      .replace('#include <opaque_fragment>', `
        {
          float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, uRimPower);
          #ifdef CHAR_HAIR
            rim *= 0.4;
          #endif
          outgoingLight += uRimColor * rim * uRimStrength;
          outgoingLight = mix(outgoingLight, vec3(4.0, 3.6, 3.2), uHitFlash);
        }
        #include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => 'rim2' + kind;
  return material;
}

export function charMat(color, roughness = 0.6, metalness = 0, extra = {}, kind = '') {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return addRim(m, kind);
}

export function physMat(params, kind = '') {
  const m = new THREE.MeshPhysicalMaterial(params);
  return addRim(m, kind);
}
