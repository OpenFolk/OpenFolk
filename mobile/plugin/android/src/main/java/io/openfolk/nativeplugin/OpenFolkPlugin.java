package io.openfolk.nativeplugin;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * OpenFolk's own plugin (JavaScript name "OpenFolk", used by webapp/js/platform.js): the end-to-end key protected by
 * the Android Keystore, and the number on the app icon.
 *
 * Values are encrypted with an AES key that never leaves the Keystore and stored in private preferences as
 * Base64 of [IV length][IV][ciphertext with tag]. After a restore onto another device the Keystore key is missing; the
 * value then reads as empty and the app asks for the key again.
 */
@CapacitorPlugin(name = "OpenFolk")
public class OpenFolkPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "openfolk-secure";
    private static final String PREFS = "openfolk-secure";
    private static final String CIPHER = "AES/GCM/NoPadding";

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String keyOf(PluginCall call) {
        String key = call.getString("key");
        return key == null || key.isEmpty() ? null : key;
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String name = keyOf(call);
        if (name == null) {
            call.reject("key missing");
            return;
        }
        JSObject result = new JSObject();
        String stored = prefs().getString(name, null);
        if (stored == null) {
            result.put("value", "");
            call.resolve(result);
            return;
        }
        try {
            ByteBuffer all = ByteBuffer.wrap(Base64.decode(stored, Base64.NO_WRAP));
            byte[] iv = new byte[all.get()];
            all.get(iv);
            byte[] sealed = new byte[all.remaining()];
            all.get(sealed);
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            result.put("value", new String(cipher.doFinal(sealed), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Keystore read failed", e);
        }
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String name = keyOf(call);
        String value = call.getString("value");
        if (name == null || value == null) {
            call.reject("key or value missing");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] all = ByteBuffer.allocate(1 + iv.length + sealed.length).put((byte) iv.length).put(iv).put(sealed).array();
            prefs().edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Keystore write failed", e);
        }
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String name = keyOf(call);
        if (name == null) {
            call.reject("key missing");
            return;
        }
        prefs().edit().remove(name).apply();
        call.resolve();
    }

    /** Android has no common API for the number on the icon; launchers show a dot for open notifications themselves. */
    @PluginMethod
    public void setBadge(PluginCall call) {
        call.resolve();
    }
}
