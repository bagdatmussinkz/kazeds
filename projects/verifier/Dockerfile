FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /app

# Download BouncyCastle
RUN wget -q -O bcprov.jar https://repo1.maven.org/maven2/org/bouncycastle/bcprov-jdk18on/1.78.1/bcprov-jdk18on-1.78.1.jar && \
    wget -q -O bcpkix.jar https://repo1.maven.org/maven2/org/bouncycastle/bcpkix-jdk18on/1.78.1/bcpkix-jdk18on-1.78.1.jar && \
    wget -q -O bcutil.jar https://repo1.maven.org/maven2/org/bouncycastle/bcutil-jdk18on/1.78.1/bcutil-jdk18on-1.78.1.jar

# Kalkan JCE provider (НУЦ РК) — native KZ GOST OIDs/curves; loaded reflectively at runtime
COPY lib/knca_provider_jce_kalkan-0.7.5.jar kalkan.jar

COPY src/Verifier.java .
RUN javac -cp "bcprov.jar:bcpkix.jar:bcutil.jar" Verifier.java

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/*.jar /app/*.class ./
# Trusted CA chain (test НУЦ РК) for certificate path validation
COPY ca/ /app/ca/

EXPOSE 8082
CMD ["java", "-cp", ".:bcprov.jar:bcpkix.jar:bcutil.jar:kalkan.jar", "Verifier"]
