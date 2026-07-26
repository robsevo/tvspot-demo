import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing material. Neither the keystore nor its passwords live in this
// repo: keystore.properties is gitignored and points at ~/.config/tvspot/.
//
// This key IS the app's identity. Android keys an install on
// (applicationId + signing certificate), so once a stranger has installed a
// signed build, only the SAME key can ever upgrade it in place. Lose it and
// every user must uninstall (losing their saved session) to move forward.
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}

android {
    namespace = "com.tvspot.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tvspot.tv"
        minSdk = 22            // Fire OS 5 / older Fire TV Sticks
        targetSdk = 34
        // BUMP THIS whenever the launcher icon or banner changes. Fire OS caches
        // app artwork keyed by package + versionCode, so reinstalling with the
        // same code leaves the OLD icon on the home row no matter what the APK
        // contains — which burned several reinstall+reboot cycles before it was
        // spotted.
        // Also the UPGRADE ordering for sideloaded installs: Fire OS refuses an
        // APK whose versionCode is <= the installed one, so this must go up on
        // every build handed out, not just on artwork changes.
        versionCode = 3
        versionName = "1.0.0"
    }

    signingConfigs {
        if (!keystoreProps.isEmpty) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
                // minSdk is 22, so Fire OS 5 sticks are in scope and they only
                // understand v1 (JAR) signatures. v2/v3 cover Fire OS 7/8.
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        // Minify stays OFF: the tiny @JavascriptInterface exit bridge must not be
        // stripped, and there is nothing here worth shrinking.
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        getByName("debug") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}

// Without keystore.properties, AGP quietly emits app-release-unsigned.apk. That
// artifact looks fine, uploads fine, and then fails to install on every stick it
// reaches — fail the build here instead of finding out from a user.
tasks.matching { it.name == "assembleRelease" }.configureEach {
    doFirst {
        if (keystoreProps.isEmpty) {
            throw GradleException(
                "firetv/keystore.properties is missing — the release APK would be unsigned " +
                    "and uninstallable. Restore it (and the .jks it points at) from backup; " +
                    "see the header of firetv/README.md."
            )
        }
    }
}
