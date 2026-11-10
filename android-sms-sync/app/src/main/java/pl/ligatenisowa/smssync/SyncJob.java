package pl.ligatenisowa.smssync;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

public final class SyncJob extends JobService {
    private static final int ID = 1601;
    private Thread worker;

    static boolean schedule(Context context, boolean enabled) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (!enabled) {
            scheduler.cancel(ID);
            return true;
        }
        JobInfo job = new JobInfo.Builder(ID, new ComponentName(context, SyncJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000L)
                .build();
        return scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS;
    }

    @Override public boolean onStartJob(JobParameters params) {
        if (!SyncSettings.preferences(this).getBoolean("automatic", false) || !SmsSync.hasPermission(this)) return false;
        worker = new Thread(() -> {
            SmsSync.run(getApplicationContext(), false);
            Thread finished = Thread.currentThread();
            new Handler(Looper.getMainLooper()).post(() -> {
                if (worker == finished) {
                    worker = null;
                    jobFinished(params, false);
                }
            });
        }, "liga-periodic-sms-sync");
        worker.start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        if (worker != null) {
            worker.interrupt();
            worker = null;
        }
        return SyncSettings.preferences(this).getBoolean("automatic", false);
    }
}
