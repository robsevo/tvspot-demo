plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
        versionCode = 2
        versionName = "0.2.0"
    }

    buildTypes {
        // Minify stays OFF: the tiny @JavascriptInterface exit bridge must not be
        // stripped, and there is nothing here worth shrinking.
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
